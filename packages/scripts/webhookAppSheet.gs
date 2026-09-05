// webhookAppSheet.gs
// Webhook para sincronizacion en tiempo real desde AppSheet → Supabase
// REGLA DE ORO: NUNCA lanzar excepcion. Siempre retornar 200 OK con JSON.
// AppSheet se detiene si el webhook falla, asi que todo va en try/catch.

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var tabla = body.tabla;   // 'ingresos' o 'egresos'
    var accion = body.accion; // 'add', 'update', 'delete'
    var id = body.id;         // ingreso_id o egreso_id

    if (!tabla || !accion || !id) {
      return respuesta('error', 'Faltan parametros: tabla, accion, id');
    }

    var resultado;
    if (tabla === 'ingresos') {
      resultado = procesarIngreso(accion, id);
    } else if (tabla === 'egresos') {
      resultado = procesarEgreso(accion, id);
    } else {
      resultado = { status: 'error', msg: 'Tabla no soportada: ' + tabla };
    }

    return respuesta(resultado.status, resultado.msg);
  } catch (err) {
    // NUNCA fallar. Loguear y retornar OK.
    Logger.log('ERROR en doPost: ' + err.message);
    return respuesta('error', 'Excepcion interna: ' + err.message);
  }
}

function doGet(e) {
  return respuesta('ok', 'Webhook activo. Usar POST para sincronizar.');
}

function respuesta(status, msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: status, msg: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Busca una fila en la hoja por el valor de la columna A (ID)
function buscarFilaPorId(nombreHoja, idBuscado) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) return null;
  var datos = hoja.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) { // skip header
    if (String(datos[i][0]).trim() === String(idBuscado).trim()) {
      return datos[i];
    }
  }
  return null;
}

// Procesar un ingreso individual (add/update/delete)
function procesarIngreso(accion, ingresoId) {
  if (accion === 'delete') {
    return eliminarDeSupabase('ingresos', 'ingreso_id', ingresoId);
  }
  // add o update: buscar fila en Sheets y upsert a Supabase
  var fila = buscarFilaPorId('Ingresos', ingresoId);
  if (!fila) {
    return { status: 'error', msg: 'Ingreso no encontrado en Sheets: ' + ingresoId };
  }
  var obj = filaAObjetoSincIngreso(fila);
  if (!obj) {
    return { status: 'error', msg: 'No se pudo mapear ingreso: ' + ingresoId };
  }
  var resp = upsertLoteIngresos([obj]);
  if (resp.code >= 300) {
    return { status: 'error', msg: 'Supabase HTTP ' + resp.code + ': ' + resp.body.substring(0, 200) };
  }
  return { status: 'ok', msg: 'Ingreso ' + accion + ' sincronizado: ' + ingresoId };
}

// Procesar un egreso individual (add/update/delete)
function procesarEgreso(accion, egresoId) {
  if (accion === 'delete') {
    return eliminarDeSupabase('egresos', 'egreso_id', egresoId);
  }
  var fila = buscarFilaPorId('Egresos', egresoId);
  if (!fila) {
    return { status: 'error', msg: 'Egreso no encontrado en Sheets: ' + egresoId };
  }
  var obj = filaAObjetoSincEgreso(fila);
  if (!obj) {
    return { status: 'error', msg: 'No se pudo mapear egreso: ' + egresoId };
  }
  var resp = upsertLoteSincEgresos([obj]);
  if (resp.code >= 300) {
    return { status: 'error', msg: 'Supabase HTTP ' + resp.code + ': ' + resp.body.substring(0, 200) };
  }
  return { status: 'ok', msg: 'Egreso ' + accion + ' sincronizado: ' + egresoId };
}

// Eliminar un registro de Supabase por su ID
function eliminarDeSupabase(tabla, columnaId, valorId) {
  var url = SUPABASE_URL + '/rest/v1/' + tabla + '?' + columnaId + '=eq.' + encodeURIComponent(valorId);
  var resp = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal'
    },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 300) {
    return { status: 'error', msg: 'DELETE ' + tabla + ' HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 200) };
  }
  return { status: 'ok', msg: tabla + ' eliminado: ' + valorId };
}