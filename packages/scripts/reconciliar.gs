// =============================================================================
// reconciliar.gs — Reconciliación bidireccional (detección y purga de FANTASMAS)
// =============================================================================
// PROBLEMA: el sync Sheets→Supabase es solo UPSERT (nunca DELETE). Cuando un
//   registro se borra en Sheets (fuente de verdad), Supabase no se entera y el
//   registro queda "fantasma", descuadrando el stock.
//
// SOLUCIÓN: comparar el 100% de los IDs de ambos lados y borrar los que están
//   en Supabase pero ya NO están en Sheets, con dos candados de seguridad:
//
//   CANDADO 1 — Dry-run (no borra):
//     Por defecto la purga está APAGADA. La función solo IMPRIME los fantasmas.
//     Para borrar de verdad, ejecutar `activarPurga()` una sola vez (autorización
//     explícita y registrada en el log).
//
//   CANDADO 2 — Guard de origin (no toca lo que vino de la web):
//     NUNCA borra registros con origin='web'. El dry-run separa en TRES listas:
//       [1] SEGUROS   (origin='sheets') → borrables con certeza
//       [2] REVISAR   (origin=NULL)     → revisar manualmente antes de purgar
//       [3] PROTEGIDOS (origin='web')   → nunca se borran
//     La purga (activarPurga) borra [1] y [2]; nunca [3].
//
// COSTO: leer los IDs paginados (~70 GET) + borrar en lote ≈ 1 minuto/día.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────
// Control de seguridad (dry-run vs purga real)
// ─────────────────────────────────────────────────────────────────────────
function _estaPurgaActiva() {
  return PropertiesService.getScriptProperties().getProperty('MODO_PURGA') === 'true';
}

function activarPurga() {
  PropertiesService.getScriptProperties().setProperty('MODO_PURGA', 'true');
  Logger.log('⚠️ PURGA ACTIVADA: reconciliar borrará fantasmas de Supabase (solo origin != web)');
}

function desactivarPurga() {
  PropertiesService.getScriptProperties().setProperty('MODO_PURGA', 'false');
  Logger.log('PURGA DESACTIVADA: reconciliar solo imprimirá (dry-run)');
}

// ─────────────────────────────────────────────────────────────────────────
// Entradas públicas
// ─────────────────────────────────────────────────────────────────────────
function reconciliarEgresos() {
  _reconciliarTabla('Egresos', 'egresos', 'egreso_id');
}

function reconciliarIngresos() {
  _reconciliarTabla('Ingresos', 'ingresos', 'ingreso_id');
}

function reconciliarTodo() {
  reconciliarEgresos();
  reconciliarIngresos();
}

// ─────────────────────────────────────────────────────────────────────────
// Setup del trigger diario (ejecutar UNA vez, o crear manual en la UI)
// ─────────────────────────────────────────────────────────────────────────
function crearTriggerReconciliacion() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'reconciliarTodo') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('reconciliarTodo')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  Logger.log('Trigger reconciliarTodo creado: diario a las 3:00 AM');
}

// ─────────────────────────────────────────────────────────────────────────
// Motor genérico de reconciliación
// ─────────────────────────────────────────────────────────────────────────
function _reconciliarTabla(nombreHoja, nombreTabla, columnaId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) { Logger.log('reconciliar: hoja ' + nombreHoja + ' no encontrada'); return; }

  // 1) Leer TODOS los IDs de Sheets (columna A)
  var ultimaFila = hoja.getLastRow();
  var setA = {};
  if (ultimaFila >= 2) {
    var colA = hoja.getRange(2, 1, ultimaFila - 1, 1).getValues();
    for (var i = 0; i < colA.length; i++) {
      var v = colA[i][0];
      if (v !== '' && v !== null && v !== undefined) {
        setA[String(v).trim()] = true;
      }
    }
  }
  Logger.log('reconciliar[' + nombreTabla + ']: Sheets tiene ' + Object.keys(setA).length + ' IDs');

  // 2) Leer TODOS los IDs + origin de Supabase (paginado)
  var fantasmas = [];
  var offset = 0;
  var pageSize = 1000;
  while (true) {
    var url = SUPABASE_URL + '/rest/v1/' + nombreTabla +
      '?select=' + columnaId + ',origin&offset=' + offset + '&limit=' + pageSize;
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      Logger.log('reconciliar[' + nombreTabla + ']: HTTP ' + resp.getResponseCode() +
        ' en offset ' + offset + ' — se detiene');
      break;
    }
    var rows = JSON.parse(resp.getContentText());
    if (rows.length === 0) break;
    for (var j = 0; j < rows.length; j++) {
      var idSup = rows[j][columnaId] ? String(rows[j][columnaId]).trim() : '';
      if (idSup && !setA[idSup]) {
        fantasmas.push({ id: idSup, origin: rows[j].origin || null });
      }
    }
    offset += pageSize;
    if (rows.length < pageSize) break;
  }
  Logger.log('reconciliar[' + nombreTabla + ']: ' + fantasmas.length +
    ' fantasmas (en Supabase, no en Sheets)');

  if (fantasmas.length === 0) return;

  // 3) Guard de origin: separar en tres grupos
  var aSeguros = [];   // origin='sheets' → seguros de borrar
  var aRevisar = [];   // origin=NULL    → revisar manualmente
  var aProteger = [];  // origin='web'   → proteger (NUNCA borrar)
  for (var k = 0; k < fantasmas.length; k++) {
    var orig = fantasmas[k].origin;
    if (orig === 'web') aProteger.push(fantasmas[k]);
    else if (orig === 'sheets') aSeguros.push(fantasmas[k]);
    else aRevisar.push(fantasmas[k]); // null u otro valor ambiguo
  }

  // 4) Dry-run vs purga
  if (!_estaPurgaActiva()) {
    Logger.log('DRY-RUN[' + nombreTabla + ']:');
    Logger.log('  [1] SEGUROS de borrar (origin=sheets): ' + aSeguros.length);
    for (var s = 0; s < aSeguros.length; s++) {
      Logger.log('      ' + aSeguros[s].id);
    }
    Logger.log('  [2] REVISAR MANUALMENTE (origin=null): ' + aRevisar.length);
    for (var r = 0; r < aRevisar.length; r++) {
      Logger.log('      ' + aRevisar[r].id + '  <-- REVISAR');
    }
    Logger.log('  [3] PROTEGIDOS (origin=web, NO se tocan): ' + aProteger.length);
    for (var p = 0; p < aProteger.length; p++) {
      Logger.log('      ' + aProteger[p].id);
    }
    return;
  }

  // 5) Purga real (borra SEGUROS + REVISAR en lotes de 50; nunca web)
  var aBorrar = aSeguros.concat(aRevisar);
  if (aBorrar.length === 0) return;
  var lote = [];
  for (var n = 0; n < aBorrar.length; n++) {
    lote.push(aBorrar[n].id);
    if (lote.length >= 50 || n === aBorrar.length - 1) {
      var filtro = columnaId + '=in.(' +
        lote.map(function(id) { return encodeURIComponent(id); }).join(',') + ')';
      var urlDel = SUPABASE_URL + '/rest/v1/' + nombreTabla + '?' + filtro;
      var respDel = UrlFetchApp.fetch(urlDel, {
        method: 'delete',
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
        muteHttpExceptions: true
      });
      Logger.log('reconciliar[' + nombreTabla + ']: DELETE lote de ' + lote.length +
        ' -> HTTP ' + respDel.getResponseCode());
      lote = [];
    }
  }
}
