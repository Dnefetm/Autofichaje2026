// =============================================================================
// reconciliar.gs — Reconciliación bidireccional (detección y purga de FANTASMAS)
// =============================================================================
// CANDADO 1 — Dry-run: por defecto la purga está APAGADA (MODO_PURGA).
// CANDADO 2 — Guard de origin: NUNCA borra origin='web'.
// CANDADO 3 — Cordura: aborta si la hoja se leyó con 0 IDs o si los fantasmas
//   superan UMBRAL_FANTASMAS del total de Supabase.
// CANDADO 4 — Paginación íntegra: usa order= y aborta si un GET != 200.
// REPORTE DE HIJOS: por cada fantasma reporta qué filas arrastraría un CASCADE
//   y cuáles lo BLOQUEARÍAN por NO ACTION; los bloqueados se excluyen.
// NOTA: los IDs se leen con getDisplayValues() — getValues() convierte celdas
//   como "13feb0128" en objetos Date y genera IDs corruptos.
// =============================================================================

var UMBRAL_FANTASMAS = 0.02;

// FKs reales de public.articulos segun pg_constraint en la base viva
// (NO segun packages/db/schema.sql, que esta desactualizado).
// Verificado el 13-sep-2026: 11 CASCADE + 5 NO ACTION.
var FKS_ARTICULOS = [
  { tabla: 'bundle_components',           col: 'component_sku', regla: 'CASCADE' },
  { tabla: 'bundle_components',           col: 'bundle_sku',    regla: 'CASCADE' },
  { tabla: 'inventory_snapshot',          col: 'sku',           regla: 'CASCADE' },
  { tabla: 'mapeo_publicacion_articulo',  col: 'articulo_id',   regla: 'CASCADE' },
  { tabla: 'marketplace_prices',          col: 'articulo_id',   regla: 'CASCADE' },
  { tabla: 'ml_publicacion_sync_queue',   col: 'articulo_id',   regla: 'CASCADE' },
  { tabla: 'precio_recalc_queue',         col: 'articulo_id',   regla: 'CASCADE' },
  { tabla: 'precios_historial_proveedor', col: 'articulo_id',   regla: 'CASCADE' },
  { tabla: 'precios_publicacion',         col: 'articulo_id',   regla: 'CASCADE' },
  { tabla: 'precios_publicados',          col: 'articulo_id',   regla: 'CASCADE' },
  { tabla: 'proveedor_articulos_alias',   col: 'articulo_id',   regla: 'CASCADE' },
  { tabla: 'costos_articulo',             col: 'articulo_id',   regla: 'NO ACTION' },
  { tabla: 'fichas_tecnicas',             col: 'articulo_id',   regla: 'NO ACTION' },
  { tabla: 'orden_items',                 col: 'articulo_id',   regla: 'NO ACTION' },
  { tabla: 'precio_revisiones_manuales',  col: 'articulo_id',   regla: 'NO ACTION' },
  { tabla: 'reservaciones_stock',         col: 'articulo_id',   regla: 'NO ACTION' }
];

function _estaPurgaActiva() {
  return PropertiesService.getScriptProperties().getProperty('MODO_PURGA') === 'true';
}

function activarPurga() {
  PropertiesService.getScriptProperties().setProperty('MODO_PURGA', 'true');
  Logger.log('PURGA ACTIVADA: reconciliar borrara fantasmas de Supabase (solo origin != web)');
}

function desactivarPurga() {
  PropertiesService.getScriptProperties().setProperty('MODO_PURGA', 'false');
  Logger.log('PURGA DESACTIVADA: reconciliar solo imprimira (dry-run)');
}

function reconciliarEgresos() {
  _reconciliarTabla('Egresos', 'egresos', 'egreso_id', null);
}

function reconciliarIngresos() {
  _reconciliarTabla('Ingresos', 'ingresos', 'ingreso_id', null);
}

function reconciliarArticulos() {
  _reconciliarTabla('Artículos', 'articulos', 'articulo_id', FKS_ARTICULOS);
}

function reconciliarTodo() {
  reconciliarEgresos();
  reconciliarIngresos();
  reconciliarArticulos();
}

function crearTriggerReconciliacion() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'reconciliarTodo') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('reconciliarTodo').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Trigger reconciliarTodo creado: diario a las 3:00 AM');
}

function _cabecerasSb() {
  return { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY };
}

function _listaIn(ids) {
  return encodeURIComponent(ids.map(function (x) {
    return '"' + String(x).replace(/"/g, '\\"') + '"';
  }).join(','));
}

/** Consulta las tablas hijas: devuelve filas por id y los ids bloqueados. */
function _inspeccionarHijos(ids, fks) {
  var porId = {};
  var bloqueados = {};
  for (var i = 0; i < ids.length; i++) porId[ids[i]] = [];
  for (var f = 0; f < fks.length; f++) {
    var fk = fks[f];
    for (var p = 0; p < ids.length; p += 25) {
      var lote = ids.slice(p, p + 25);
      var url = SUPABASE_URL + '/rest/v1/' + fk.tabla +
        '?select=' + fk.col + '&' + fk.col + '=in.(' + _listaIn(lote) + ')';
      var r = UrlFetchApp.fetch(url, { method: 'get', headers: _cabecerasSb(), muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) {
        Logger.log('  ! no se pudo inspeccionar ' + fk.tabla + '.' + fk.col +
          ': HTTP ' + r.getResponseCode() + ' - ' + r.getContentText().slice(0, 120));
        continue;
      }
      var filas = JSON.parse(r.getContentText());
      var cuenta = {};
      for (var q = 0; q < filas.length; q++) {
        var v = String(filas[q][fk.col]);
        cuenta[v] = (cuenta[v] || 0) + 1;
      }
      for (var id in cuenta) {
        if (!porId[id]) porId[id] = [];
        porId[id].push({ tabla: fk.tabla, col: fk.col, regla: fk.regla, n: cuenta[id] });
        if (fk.regla !== 'CASCADE') bloqueados[id] = true;
      }
    }
  }
  return { porId: porId, bloqueados: bloqueados };
}

function _imprimirHijos(id, lista) {
  if (!lista || lista.length === 0) { Logger.log('        sin filas hijas'); return; }
  for (var i = 0; i < lista.length; i++) {
    var h = lista[i];
    Logger.log('        ' + (h.regla === 'CASCADE' ? 'arrastra  ' : 'BLOQUEA   ') +
      h.tabla + '.' + h.col + ' x' + h.n + '  (' + h.regla + ')');
  }
}

function _reconciliarTabla(nombreHoja, nombreTabla, columnaId, fks) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) { Logger.log('reconciliar: hoja ' + nombreHoja + ' no encontrada - ABORTA'); return; }

  var ultimaFila = hoja.getLastRow();
  var setA = {};
  if (ultimaFila >= 2) {
    var colA = hoja.getRange(2, 1, ultimaFila - 1, 1).getDisplayValues();
    for (var i = 0; i < colA.length; i++) {
      var v = String(colA[i][0]).trim();
      if (v) setA[v] = true;
    }
  }
  var nSheets = Object.keys(setA).length;
  Logger.log('reconciliar[' + nombreTabla + ']: Sheets tiene ' + nSheets + ' IDs');
  if (nSheets === 0) {
    Logger.log('reconciliar[' + nombreTabla + ']: ABORTA - la hoja se leyo con 0 IDs');
    return;
  }

  var fantasmas = [];
  var setSup = {};
  var totalSup = 0;
  var offset = 0;
  var pageSize = 1000;
  while (true) {
    var url = SUPABASE_URL + '/rest/v1/' + nombreTabla +
      '?select=' + columnaId + ',origin&order=' + columnaId + '.asc' +
      '&offset=' + offset + '&limit=' + pageSize;
    var resp = UrlFetchApp.fetch(url, { method: 'get', headers: _cabecerasSb(), muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      Logger.log('reconciliar[' + nombreTabla + ']: ABORTA - HTTP ' + resp.getResponseCode() +
        ' en offset ' + offset + ' (lectura incompleta, no se purga)');
      return;
    }
    var rows = JSON.parse(resp.getContentText());
    if (rows.length === 0) break;
    for (var j = 0; j < rows.length; j++) {
      totalSup++;
      var idSup = rows[j][columnaId] ? String(rows[j][columnaId]).trim() : '';
      if (!idSup) continue;
      setSup[idSup] = true;
      if (!setA[idSup]) fantasmas.push({ id: idSup, origin: rows[j].origin || null });
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  Logger.log('reconciliar[' + nombreTabla + ']: Supabase tiene ' + totalSup + ' filas');

  var faltantes = [];
  for (var idA in setA) { if (!setSup[idA]) faltantes.push(idA); }
  Logger.log('reconciliar[' + nombreTabla + ']: ' + faltantes.length +
    ' IDs en Sheets que NO estan en Supabase (sync pendiente)');
  if (faltantes.length > 0) Logger.log('      ' + JSON.stringify(faltantes.slice(0, 30)));

  Logger.log('reconciliar[' + nombreTabla + ']: ' + fantasmas.length +
    ' fantasmas (en Supabase, no en Sheets)');
  if (fantasmas.length === 0) return;

  if (totalSup > 0 && (fantasmas.length / totalSup) > UMBRAL_FANTASMAS) {
    Logger.log('reconciliar[' + nombreTabla + ']: ABORTA - ' + fantasmas.length + '/' + totalSup +
      ' (' + (100 * fantasmas.length / totalSup).toFixed(1) + '%) supera el umbral de ' +
      (100 * UMBRAL_FANTASMAS) + '%. Revisar la lectura de la hoja antes de purgar.');
    return;
  }

  var aSeguros = [], aRevisar = [], aProteger = [];
  for (var k = 0; k < fantasmas.length; k++) {
    var orig = fantasmas[k].origin;
    if (orig === 'web') aProteger.push(fantasmas[k]);
    else if (orig === 'sheets') aSeguros.push(fantasmas[k]);
    else aRevisar.push(fantasmas[k]);
  }

  var candidatos = aSeguros.concat(aRevisar).map(function (x) { return x.id; });
  var insp = { porId: {}, bloqueados: {} };
  if (fks && candidatos.length > 0) insp = _inspeccionarHijos(candidatos, fks);

  if (!_estaPurgaActiva()) {
    Logger.log('DRY-RUN[' + nombreTabla + ']:');
    Logger.log('  [1] SEGUROS de borrar (origin=sheets): ' + aSeguros.length);
    for (var s = 0; s < aSeguros.length; s++) {
      Logger.log('      ' + aSeguros[s].id);
      if (fks) _imprimirHijos(aSeguros[s].id, insp.porId[aSeguros[s].id]);
    }
    Logger.log('  [2] REVISAR MANUALMENTE (origin=null): ' + aRevisar.length);
    for (var r = 0; r < aRevisar.length; r++) {
      Logger.log('      ' + aRevisar[r].id + '  <-- REVISAR');
      if (fks) _imprimirHijos(aRevisar[r].id, insp.porId[aRevisar[r].id]);
    }
    Logger.log('  [3] PROTEGIDOS (origin=web, NO se tocan): ' + aProteger.length);
    for (var p = 0; p < aProteger.length; p++) Logger.log('      ' + aProteger[p].id);
    if (fks) {
      var nBloq = Object.keys(insp.bloqueados).length;
      Logger.log('  [4] BLOQUEADOS por FK NO ACTION (no se podrian borrar): ' + nBloq);
      for (var b in insp.bloqueados) Logger.log('      ' + b);
    }
    return;
  }

  var aBorrar = [];
  for (var c = 0; c < candidatos.length; c++) {
    if (insp.bloqueados[candidatos[c]]) {
      Logger.log('reconciliar[' + nombreTabla + ']: SE OMITE ' + candidatos[c] + ' - bloqueado por FK NO ACTION');
      continue;
    }
    aBorrar.push(candidatos[c]);
  }
  if (aBorrar.length === 0) { Logger.log('reconciliar[' + nombreTabla + ']: nada que borrar'); return; }

  if (fks) {
    for (var d = 0; d < aBorrar.length; d++) {
      Logger.log('  borrando ' + aBorrar[d] + ':');
      _imprimirHijos(aBorrar[d], insp.porId[aBorrar[d]]);
    }
  }

  var lote = [];
  for (var n = 0; n < aBorrar.length; n++) {
    lote.push(aBorrar[n]);
    if (lote.length >= 50 || n === aBorrar.length - 1) {
      var urlDel = SUPABASE_URL + '/rest/v1/' + nombreTabla + '?' + columnaId + '=in.(' + _listaIn(lote) + ')';
      var respDel = UrlFetchApp.fetch(urlDel, { method: 'delete', headers: _cabecerasSb(), muteHttpExceptions: true });
      var codigo = respDel.getResponseCode();
      Logger.log('reconciliar[' + nombreTabla + ']: DELETE lote de ' + lote.length + ' -> HTTP ' + codigo);
      if (codigo >= 300) Logger.log('      ERROR: ' + respDel.getContentText().slice(0, 300));
      lote = [];
    }
  }
}
