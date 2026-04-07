// pushArticulos.gs
// Mecanismo PUSH para artículos: 1 HTTP call por edición, no polling.
//
// CÓMO INSTALAR (una sola vez, no se puede hacer desde código):
//   Apps Script → Activadores (ícono reloj) → + Añadir activador
//     Función:           onEditArticulos
//     Evento:            Del spreadsheet → Al editar
//   (Si AppSheet también escribe filas nuevas, agregar un segundo activador
//    con "Al cambiar" para capturar inserciones programáticas)
//
// IMPORTANTE: El trigger "Simple onEdit(e)" integrado (sin instalar) NO puede
// hacer llamadas externas (UrlFetch). DEBES usar un "installable trigger".
//
// Reutiliza buildRegistroArticulo() y getHashesExistentesArticulos() de sincArticulos.gs.

// ─────────────────────────────────────────────────────────────────────
// onEditArticulos(e) — handler del installable trigger
// ─────────────────────────────────────────────────────────────────────
function onEditArticulos(e) {
  // Validar que el evento existe (resguardo ante ejecuciones manuales)
  if (!e || !e.source) {
    Logger.log('pushArticulos: sin evento. ¿Ejecutando manualmente? Usa sincArticulos() para sync manual.');
    return;
  }

  // Solo actuar en la hoja "Artículos"
  var hoja = e.source.getActiveSheet();
  if (hoja.getName() !== HOJA_ARTICULOS_SINC) return;

  // Ignorar ediciones en el encabezado
  var fila = e.range.getRow();
  if (fila < 2) return;

  // Leer la fila completa (35 columnas, A–AI)
  var row = hoja.getRange(fila, 1, 1, 35).getValues()[0];
  var registro = buildRegistroArticulo(row);

  // Si la fila no tiene articulo_id válido, ignorar
  if (!registro) {
    Logger.log('pushArticulos: fila ' + fila + ' sin articulo_id, ignorada.');
    return;
  }

  // Verificar hash: si el artículo ya existe y no cambió nada, skip
  var hashesExistentes = getHashesExistentesArticulos([registro.articulo_id]);
  var hashActual = hashesExistentes[registro.articulo_id];
  if (hashActual && hashActual === registro.sync_hash) {
    Logger.log('pushArticulos: ' + registro.articulo_id + ' sin cambios (hash igual), skip.');
    return;
  }

  // UPSERT de UNA sola fila — 1 HTTP call
  var url = SUPABASE_URL + '/rest/v1/articulos?on_conflict=articulo_id';
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal,resolution=merge-duplicates',
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify([registro]),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();

  if (code >= 200 && code < 300) {
    Logger.log('pushArticulos: ✅ ' + registro.articulo_id + ' enviado a Supabase (fila ' + fila + ').');
  } else {
    Logger.log('pushArticulos: ❌ HTTP ' + code + ' — ' + response.getContentText().slice(0, 300));
  }
}

// ─────────────────────────────────────────────────────────────────────
// onEditIngresos(e) — push para hoja "Ingresos"
// Instalar igual: Al editar → onEditIngresos
// ─────────────────────────────────────────────────────────────────────
function onEditIngresos(e) {
  if (!e || !e.source) return;
  var hoja = e.source.getActiveSheet();
  if (hoja.getName() !== HOJA_INGRESOS_SINC) return;

  var fila = e.range.getRow();
  if (fila < 2) return;

  var row = hoja.getRange(fila, 1, 1, 13).getValues()[0];
  var obj = filaAObjetoSincIngreso(row);
  if (!obj) {
    Logger.log('pushIngresos: fila ' + fila + ' sin articulo_id, ignorada.');
    return;
  }

  // Verificar hash
  var hashesExistentes = getHashesExistentes([obj.ingreso_id]);
  var hashActual = hashesExistentes[obj.ingreso_id];
  if (obj.ingreso_id && hashActual && hashActual === obj.sync_hash) {
    Logger.log('pushIngresos: ' + obj.ingreso_id + ' sin cambios, skip.');
    return;
  }

  var resp = upsertLoteIngresos([obj]);
  if (resp.code >= 200 && resp.code < 300) {
    Logger.log('pushIngresos: ✅ fila ' + fila + ' enviada (' + (obj.ingreso_id || 'sin ID') + ').');
  } else {
    Logger.log('pushIngresos: ❌ HTTP ' + resp.code + ' — ' + resp.body.slice(0, 300));
  }
}

// ─────────────────────────────────────────────────────────────────────
// onEditEgresos(e) — push para hoja "Egresos"
// Instalar igual: Al editar → onEditEgresos
// ─────────────────────────────────────────────────────────────────────
function onEditEgresos(e) {
  if (!e || !e.source) return;
  var hoja = e.source.getActiveSheet();
  if (hoja.getName() !== HOJA_EGRESOS_SINC) return;

  var fila = e.range.getRow();
  if (fila < 2) return;

  var row = hoja.getRange(fila, 1, 1, 23).getValues()[0];
  var obj = filaAObjetoSincEgreso(row);
  if (!obj) {
    Logger.log('pushEgresos: fila ' + fila + ' sin articulo_id, ignorada.');
    return;
  }

  // Verificar hash
  var hashesExistentes = getHashesExistentesEgresos([obj.egreso_id]);
  var hashActual = hashesExistentes[obj.egreso_id];
  if (obj.egreso_id && hashActual && hashActual === obj.sync_hash) {
    Logger.log('pushEgresos: ' + obj.egreso_id + ' sin cambios, skip.');
    return;
  }

  var resp = upsertLoteSincEgresos([obj]);
  if (resp.code >= 200 && resp.code < 300) {
    Logger.log('pushEgresos: ✅ fila ' + fila + ' enviada (' + (obj.egreso_id || 'sin ID') + ').');
  } else {
    Logger.log('pushEgresos: ❌ HTTP ' + resp.code + ' — ' + resp.body.slice(0, 300));
  }
}
