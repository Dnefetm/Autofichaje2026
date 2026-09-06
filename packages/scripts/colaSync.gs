// =============================================================================
// colaSync.gs — Cola de Sincronización Asíncrona (Fire-and-Forget)
// =============================================================================
// PROBLEMA RESUELTO: el webhook síncrono anterior hacía getDataRange() (lectura
//   completa O(N)) por cada edición y bloqueaba AppSheet 28–70s, saturando la
//   cuota de Google (90 min/día) y los 30 ejecuciones simultáneas.
//
// ARQUITECTURA:
//   1) doPost (webhook de AppSheet) → anota (tabla, id) en "Cola_Sync" y
//      responde 200 en <0.5s. NO lee Sheets, NO llama a Supabase.
//   2) Timer "procesarColaSync" (cada 2 min) → drena la cola: lee SOLO la
//      columna A (IDs) de la hoja correspondiente, lee la fila puntual y hace
//      upsert batcheado reutilizando los builders existentes.
//
// COSTO ESTIMADO: ~10 min/día de runtime total (muy por debajo de 90 min).
// =============================================================================

var HOJA_COLA_SYNC = 'Cola_Sync';

// ─────────────────────────────────────────────────────────────────────────
// Webhook receptor de AppSheet.
// Espera: { "tabla": "egresos"|"ingresos", "accion": "add"|"update",
//           "id": "<ID Egreso|ID ingreso>" }
// Nunca devuelve error a AppSheet para romper el ciclo de reintentos.
// ─────────────────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }

    var tabla = String(data.tabla || '').trim().toLowerCase();
    var id = (data.id !== undefined && data.id !== null)
      ? String(data.id).trim()
      : '';

    // Solo egresos/ingresos con ID válido
    if ((tabla !== 'egresos' && tabla !== 'ingresos') || id === '') {
      return _colaRespJson({ status: 'ignored' });
    }

    if (data.accion === 'delete') {
      if (typeof eliminarDeSupabase === 'function') {
         eliminarDeSupabase(tabla, (tabla === 'egresos' ? 'egreso_id' : 'ingreso_id'), id);
      }
    } else {
      _colaEncolar(tabla, id);
    }

    return _colaRespJson({ status: 'queued' });
  } catch (err) {
    // Log local, pero siempre responder 200 a AppSheet
    Logger.log('colaSync.doPost error: ' + err);
    return _colaRespJson({ status: 'error', msg: String(err) });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Timer: drena la cola. Ejecutar cada 2 minutos.
// ─────────────────────────────────────────────────────────────────────────
function procesarColaSync() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cola = ss.getSheetByName(HOJA_COLA_SYNC);
  if (!cola) return; // la cola aún no existe

  var ultimaFila = cola.getLastRow();
  if (ultimaFila < 2) return; // solo encabezado o vacía

  // Leer lo que existe AHORA y borrar SOLO esas filas.
  // Si un doPost anexa durante el proceso, la fila nueva queda fuera del rango
  // borrado y se procesa en la siguiente corrida (sin pérdida).
  var datos = cola.getRange(2, 1, ultimaFila - 1, 2).getValues();
  cola.deleteRows(2, ultimaFila - 1);

  // Agrupar por tabla con dedupe
  var porTabla = {};
  for (var i = 0; i < datos.length; i++) {
    var t = String(datos[i][0] || '').trim().toLowerCase();
    var id = (datos[i][1] !== undefined && datos[i][1] !== null)
      ? String(datos[i][1]).trim()
      : '';
    if ((t !== 'egresos' && t !== 'ingresos') || id === '') continue;
    if (!porTabla[t]) porTabla[t] = {};
    porTabla[t][id] = true;
  }

  var ids;
  if (porTabla['egresos']) {
    ids = Object.keys(porTabla['egresos']);
    if (ids.length > 0) _colaProcesarEgresos(ids);
  }
  if (porTabla['ingresos']) {
    ids = Object.keys(porTabla['ingresos']);
    if (ids.length > 0) _colaProcesarIngresos(ids);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Setup del trigger (ejecutar UNA sola vez, o crearlo manual en la UI)
// ─────────────────────────────────────────────────────────────────────────
function crearTriggerColaSync() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'procesarColaSync') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('procesarColaSync')
    .timeBased()
    .everyMinutes(2)
    .create();
  Logger.log('Trigger procesarColaSync creado: cada 2 minutos');
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────
function _colaRespJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _colaEncolar(tabla, id) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var cola = ss.getSheetByName(HOJA_COLA_SYNC);
  if (!cola) {
    cola = ss.insertSheet(HOJA_COLA_SYNC);
    cola.appendRow(['tabla', 'id']); // encabezado
  }
  cola.appendRow([tabla, id]);
}

// Lee SOLO la columna A (IDs) y devuelve { id: numeroDeFila }
function _colaMapaIds(hoja, ultimaFila) {
  if (ultimaFila < 2) return {};
  var colA = hoja.getRange(2, 1, ultimaFila - 1, 1).getValues();
  var mapa = {};
  for (var i = 0; i < colA.length; i++) {
    var v = colA[i][0];
    if (v !== '' && v !== null && v !== undefined) {
      mapa[String(v).trim()] = i + 2; // fila real = i + 2
    }
  }
  return mapa;
}

function _colaProcesarEgresos(ids) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS_SINC);
  if (!hoja) return;

  var mapa = _colaMapaIds(hoja, hoja.getLastRow());
  var objetos = [];

  for (var i = 0; i < ids.length; i++) {
    var fila = mapa[ids[i]];
    if (!fila) continue; // ya no existe en Sheets
    var row = hoja.getRange(fila, 1, 1, 23).getValues()[0];
    var obj = filaAObjetoSincEgreso(row); // reusa el builder existente
    if (obj) objetos.push(obj);
  }

  if (objetos.length > 0) {
    upsertEgresosBatch(objetos); // reusa el upsert existente
    Logger.log('colaSync egresos procesados: ' + objetos.length);
  }
}

function _colaProcesarIngresos(ids) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_INGRESOS_SINC);
  if (!hoja) return;

  var mapa = _colaMapaIds(hoja, hoja.getLastRow());
  var objetos = [];

  for (var i = 0; i < ids.length; i++) {
    var fila = mapa[ids[i]];
    if (!fila) continue; // ya no existe en Sheets
    var row = hoja.getRange(fila, 1, 1, 13).getValues()[0];
    var obj = filaAObjetoSincIngreso(row); // reusa el builder existente
    if (obj) objetos.push(obj);
  }

  if (objetos.length > 0) {
    upsertLoteIngresos(objetos); // reusa el upsert existente (devuelve {code, body})
    Logger.log('colaSync ingresos procesados: ' + objetos.length);
  }
}
