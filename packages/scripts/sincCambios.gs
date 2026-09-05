// sincCambios.gs
// Sincronizacion en tiempo real: detecta ediciones en hojas
// Ingresos, Egresos y Articulos, y sincroniza la fila editada a Supabase.
// Esta funcion se dispara via trigger onEdit instalable.

// ===== HANDLER onEdit INSTALABLE =====
function onEditSincCambios(e) {
  if (!e || !e.range) return;

  var hoja = e.range.getSheet();
  var nombreHoja = hoja.getName();

  // Solo actuar en hojas Ingresos, Egresos y Articulos
  if (nombreHoja !== 'Ingresos' && nombreHoja !== 'Egresos' && nombreHoja !== 'Artículos') return;

  var fila = e.range.getRow();
  // Ignorar header (fila 1)
  if (fila <= 1) return;

  Logger.log('onEditSincCambios: hoja=' + nombreHoja + ' fila=' + fila);

  try {
    var datos = hoja.getRange(fila, 1, 1, hoja.getLastColumn()).getValues()[0];

    if (nombreHoja === 'Ingresos') {
      sincronizarFilaIngreso(datos, fila);
    } else if (nombreHoja === 'Egresos') {
      sincronizarFilaEgreso(datos, fila);
    } else if (nombreHoja === 'Artículos') {
      sincronizarFilaArticulo(datos, fila);
    }
  } catch (err) {
    Logger.log('ERROR onEditSincCambios: ' + err.message);
  }
}

// ===== SYNC INDIVIDUAL: INGRESOS =====
function sincronizarFilaIngreso(datos, numFila) {
  var obj = filaAObjetoSincIngreso(datos); // definida en sincIngresos.gs
  if (!obj) {
    Logger.log('sincronizarFilaIngreso: fila ' + numFila + ' sin ID, omitida');
    return;
  }
  var url = SUPABASE_URL + '/rest/v1/ingresos?on_conflict=ingreso_id';
  var resp = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates'
    },
    payload: JSON.stringify([obj]),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) {
    Logger.log('sincronizarFilaIngreso: fila ' + numFila + ' OK');
  } else {
    Logger.log('sincronizarFilaIngreso: fila ' + numFila + ' ERROR ' + code + ' - ' + resp.getContentText());
  }
}

// ===== SYNC INDIVIDUAL: EGRESOS =====
function sincronizarFilaEgreso(datos, numFila) {
  var obj = filaAObjetoSincEgreso(datos); // definida en sincEgresos.gs
  if (!obj) {
    Logger.log('sincronizarFilaEgreso: fila ' + numFila + ' sin ID, omitida');
    return;
  }
  var url = SUPABASE_URL + '/rest/v1/egresos?on_conflict=egreso_id';
  var resp = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates'
    },
    payload: JSON.stringify([obj]),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) {
    Logger.log('sincronizarFilaEgreso: fila ' + numFila + ' OK');
  } else {
    Logger.log('sincronizarFilaEgreso: fila ' + numFila + ' ERROR ' + code + ' - ' + resp.getContentText());
  }
}

// NOTA: sincronizarFilaArticulo esta definida en sincArticulos.gs
// y usa filaAObjeto + upsertLote de MigrarArticulos.gs