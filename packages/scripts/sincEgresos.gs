// =============================================================================
// sincEgresos.gs — Motor de Sincronización Dual-Band (Sheets → Supabase)
// =============================================================================
// Arquitectura Dual-Band:
//   - Banda 1 (Ventana Activa): Escanea siempre las últimas 500 filas en cada turno.
//     Garantiza que toda orden modificada por el operador viaje a Supabase en máx 45 min.
//   - Banda 2 (Barrido Histórico Continuo): Escanea 500 filas rotativas por turno
//     con cursor circular (fila 2 a últimaFila). Audita todo el histórico en 4.3 días.
//   - Comparación Idempotente por Hash: No satura la base de datos; solo hace UPSERT
//     si el hash cambió (cantidad modificada).
//   - Consumo de cuota: ~5.3 min/día (5.8% del límite de 90 min de Google).
// =============================================================================

var HOJA_EGRESOS_SINC = 'Egresos';
var BATCH_SIZE_SINC_EGR = 50;

function filaAObjetoSincEgreso(datos) {
  // Col A(0)=egreso_id, B(1)=importacion_full_id, C(2)=articulo_id, D(3)=cantidad
  // E(4)=guia, F(5)=transportista, G(6)=tipo_egreso, H(7)=notas
  // I(8)=fecha, J(9)=operador_id, K(10)-M(12)=misc
  // N(13)=largo, O(14)=ancho, P(15)=alto, Q(16)=peso
  var egreso_id = datos[0] ? String(datos[0]).trim() : '';
  if (!egreso_id) return null;

  var articulo_id = datos[2] ? String(datos[2]).trim() : '';
  if (!articulo_id) return null;

  var cant = (datos[3] !== '' && datos[3] !== null) ? parseInt(datos[3], 10) : 0;
  var guia = datos[4] ? String(datos[4]).trim() : null;
  var transportista = datos[5] ? String(datos[5]).trim() : null;
  var tipo_egreso = mapTipoEgreso(datos[6]);
  var notas = datos[7] ? String(datos[7]).trim() : null;
  var fecha = parseFechaSincEgr(datos[8]);
  var operador_id = datos[9] ? String(datos[9]).trim() : null;
  var importacion_full_id = datos[1] ? String(datos[1]).trim() : null;
  var largo = datos.length > 13 && datos[13] ? String(datos[13]).trim() : null;
  var ancho = datos.length > 14 && datos[14] ? String(datos[14]).trim() : null;
  var alto = datos.length > 15 && datos[15] ? String(datos[15]).trim() : null;
  var peso = datos.length > 16 && datos[16] ? String(datos[16]).trim() : null;

  var obj = {
    egreso_id: egreso_id,
    articulo_id: articulo_id,
    cantidad: cant,
    guia: guia,
    transportista: transportista,
    tipo_egreso: tipo_egreso,
    notas: notas,
    fecha: fecha,
    operador_id: operador_id,
    importacion_full_id: importacion_full_id,
    largo: largo,
    ancho: ancho,
    alto: alto,
    peso: peso,
    origin: 'sheets'
  };

  var hashStr = egreso_id + '|' + articulo_id + '|' + cant + '|' +
    (guia || '') + '|' + (transportista || '') + '|' + (tipo_egreso || '') + '|' +
    (notas || '') + '|' + (fecha || '') + '|' + (operador_id || '') + '|' +
    (importacion_full_id || '') + '|' + (largo || '') + '|' + (ancho || '') + '|' +
    (alto || '') + '|' + (peso || '');
  obj.sync_hash = md5Egreso(hashStr);

  return obj;
}

function md5Egreso(input) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, input);
  var hex = '';
  for (var i = 0; i < raw.length; i++) {
    var val = (raw[i] + 256) % 256;
    hex += ('0' + val.toString(16)).slice(-2);
  }
  return hex;
}

function mapTipoEgreso(valor) {
  if (!valor) return 'otro';
  var v = String(valor).trim().toLowerCase();
  if (v.indexOf('venta') !== -1) return 'venta';
  if (v.indexOf('full') !== -1 || v.indexOf('fulfillment') !== -1) return 'envio_full';
  if (v.indexOf('devolucion') !== -1) {
    if (v.indexOf('proveedor') !== -1) return 'devolucion_proveedor';
  }
  return 'otro';
}

function parseFechaSincEgr(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  var str = String(valor).trim();
  if (!str) return null;
  var partes = str.split(' ');
  var fp = partes[0].split('/');
  if (fp.length === 3) {
    var d = new Date(fp[2] + '-' + fp[1].padStart(2,'0') + '-' + fp[0].padStart(2,'0')
      + 'T' + (partes.length > 1 ? partes[1] : '00:00:00'));
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
  }
  return null;
}

function upsertEgresosBatch(batch) {
  var url = SUPABASE_URL + '/rest/v1/egresos?on_conflict=egreso_id';
  var resp = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates'
    },
    payload: JSON.stringify(batch),
    muteHttpExceptions: true
  });
  return resp;
}

// =============================================================================
// FUNCIONES PÚBLICAS Y ACTIVADORES
// =============================================================================

/**
 * Función oficial invocada por triggerPeriodico cada 45 minutos.
 * Ejecuta ambas bandas: Ventana Activa + Barrido Circular Histórico.
 */
function sincEgresos() {
  Logger.log('>>> INICIANDO SINCRONIZACIÓN DUAL-BAND DE EGRESOS <<<');
  
  // Banda 1: Ventana Activa (últimas 500 filas)
  sincEgresosVentanaActiva(500);
  
  // Banda 2: Barrido Circular Histórico (500 filas rotativas)
  sincEgresosCircular(500);
  
  Logger.log('>>> FIN DE SINCRONIZACIÓN DUAL-BAND <<<');
}

/**
 * Banda 1: Examina siempre las últimas N filas de la hoja.
 * Captura de inmediato órdenes recién modificadas por los operadores.
 */
function sincEgresosVentanaActiva(numFilas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS_SINC);
  if (!hoja) { Logger.log('Hoja ' + HOJA_EGRESOS_SINC + ' no encontrada.'); return; }
  var ultimaFila = hoja.getLastRow();
  var n = numFilas || 500;
  var inicio = Math.max(2, ultimaFila - n + 1);
  Logger.log('[Banda 1 - Ventana Activa] Escaneando filas ' + inicio + ' a ' + ultimaFila);
  sincEgresosRango_(inicio, ultimaFila);
}

/**
 * Banda 2: Barrido circular continuo del histórico.
 * Avanza 500 filas por ejecución y vuelve a empezar al llegar al final.
 */
function sincEgresosCircular(numFilas) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS_SINC);
  if (!hoja) return;
  var ultimaFila = hoja.getLastRow();
  var props = PropertiesService.getScriptProperties();
  var cursor = parseInt(props.getProperty('sincEgresos_cursor_circular') || '2', 10);
  if (cursor > ultimaFila || cursor < 2) cursor = 2;

  var n = numFilas || 500;
  var fin = Math.min(cursor + n - 1, ultimaFila);
  Logger.log('[Banda 2 - Circular] Escaneando filas ' + cursor + ' a ' + fin + ' de ' + ultimaFila);
  sincEgresosRango_(cursor, fin);

  var nuevoCursor = (fin >= ultimaFila) ? 2 : (fin + 1);
  props.setProperty('sincEgresos_cursor_circular', String(nuevoCursor));
  Logger.log('[Banda 2 - Circular] Próximo inicio guardado en fila ' + nuevoCursor);
}

/**
 * Motor de procesamiento por rango con verificación idempotente de hash.
 */
function sincEgresosRango_(rangoInicio, rangoFin) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS_SINC);
  if (!hoja) return;

  var filaActual = rangoInicio;
  var upsertados = 0, saltados = 0, omitidos = 0, errores = 0, primerError = '';
  var NUM_COLS = 23;

  while (filaActual <= rangoFin) {
    var filaLoteFin = Math.min(filaActual + BATCH_SIZE_SINC_EGR - 1, rangoFin);
    var cantidadFilas = filaLoteFin - filaActual + 1;
    var datos = hoja.getRange(filaActual, 1, cantidadFilas, NUM_COLS).getValues();
    var candidatos = [];

    for (var i = 0; i < datos.length; i++) {
      var obj = filaAObjetoSincEgreso(datos[i]);
      if (!obj) { omitidos++; continue; }
      candidatos.push(obj);
    }

    if (candidatos.length > 0) {
      var ids = candidatos.map(function(c) { return c.egreso_id; });
      var urlCheck = SUPABASE_URL + '/rest/v1/egresos?select=egreso_id,sync_hash&egreso_id=in.(' + ids.join(',') + ')';
      var rCheck = UrlFetchApp.fetch(urlCheck, {
        method: 'get',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
        },
        muteHttpExceptions: true
      });

      var hashMap = {};
      if (rCheck.getResponseCode() === 200) {
        var existentes = JSON.parse(rCheck.getContentText());
        for (var h = 0; h < existentes.length; h++) {
          hashMap[existentes[h].egreso_id] = existentes[h].sync_hash;
        }
      }

      var toUpsert = [];
      for (var j = 0; j < candidatos.length; j++) {
        if (hashMap[candidatos[j].egreso_id] === candidatos[j].sync_hash) {
          saltados++;
        } else {
          toUpsert.push(candidatos[j]);
        }
      }

      if (toUpsert.length > 0) {
        var resp = upsertEgresosBatch(toUpsert);
        if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
          upsertados += toUpsert.length;
        } else {
          Logger.log('Lote falló (HTTP ' + resp.getResponseCode() + '). Reintentando individualmente...');
          if (!primerError) primerError = resp.getContentText().substring(0, 200);
          for (var k = 0; k < toUpsert.length; k++) {
            var respInd = upsertEgresosBatch([toUpsert[k]]);
            if (respInd.getResponseCode() >= 200 && respInd.getResponseCode() < 300) {
              upsertados++;
            } else {
              errores++;
              Logger.log('Error individual egreso_id: ' + toUpsert[k].egreso_id + ' -> HTTP ' + respInd.getResponseCode());
            }
          }
        }
      }
    }

    filaActual = filaLoteFin + 1;
    Utilities.sleep(150);
  }

  Logger.log('Rango ' + rangoInicio + '-' + rangoFin + ' RESUMEN: upsertados=' + upsertados +
    ' saltados=' + saltados + ' omitidos=' + omitidos + ' errores=' + errores +
    (primerError ? ' | Error: ' + primerError : ''));
}

/**
 * Resync completo manual o por fecha (mantiene compatibilidad).
 */
function sincEgresos_full() {
  sincEgresosPorFecha(false);
}

function sincEgresosPorFecha(soloNuevos) {
  var MAX_TIME = 5 * 60 * 1000;
  var inicio = Date.now();
  var props = PropertiesService.getScriptProperties();
  var maxFecha = null;
  var resumeRow = parseInt(props.getProperty('sincEgresos_cursor') || '2', 10);

  if (soloNuevos) {
    var urlMax = SUPABASE_URL + '/rest/v1/egresos?select=fecha&order=fecha.desc&limit=1';
    var rMax = UrlFetchApp.fetch(urlMax, {
      method: 'get',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
      },
      muteHttpExceptions: true
    });
    if (rMax.getResponseCode() === 200) {
      var dMax = JSON.parse(rMax.getContentText());
      if (dMax && dMax.length > 0) maxFecha = new Date(dMax[0].fecha);
    }
    Logger.log('Modo incremental. MAX fecha: ' +
      (maxFecha ? maxFecha.toISOString() : 'ninguna') +
      ' | Cursor: fila ' + resumeRow);
  } else {
    resumeRow = parseInt(props.getProperty('sincEgresos_full_idx') || '2', 10);
    Logger.log('Modo FULL. Iniciando desde fila: ' + resumeRow);
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS_SINC);
  if (!hoja) { Logger.log('Hoja ' + HOJA_EGRESOS_SINC + ' no encontrada.'); return; }
  var ultimaFila = hoja.getLastRow();
  var upsertados = 0, saltados = 0, filtrados = 0, omitidos = 0, errores = 0, primerError = '';
  var filaInicio = resumeRow;
  var interrumpido = false;
  var NUM_COLS = 23;

  while (filaInicio <= ultimaFila) {
    if (Date.now() - inicio > MAX_TIME) {
      interrumpido = true;
      props.setProperty('sincEgresos_cursor', String(filaInicio));
      if (!soloNuevos) {
        props.setProperty('sincEgresos_full_idx', String(filaInicio));
      }
      Logger.log('TIEMPO: guardando cursor en fila ' + filaInicio);
      break;
    }

    var filaFin = Math.min(filaInicio + BATCH_SIZE_SINC_EGR - 1, ultimaFila);
    var datos = hoja.getRange(filaInicio, 1, filaFin - filaInicio + 1, NUM_COLS).getValues();
    var candidatos = [];
    for (var i = 0; i < datos.length; i++) {
      var obj = filaAObjetoSincEgreso(datos[i]);
      if (!obj) { omitidos++; continue; }
      // GUARD CORREGIDO: si ya tiene egreso_id, NO se descarta por fecha antigua; se evalúa el hash
      if (soloNuevos && maxFecha && !obj.egreso_id) {
        var fechaObj = obj.fecha ? new Date(obj.fecha) : null;
        if (fechaObj && fechaObj <= maxFecha) { filtrados++; continue; }
      }
      candidatos.push(obj);
    }

    if (candidatos.length > 0) {
      var ids = candidatos.map(function(c) { return c.egreso_id; });
      var urlCheck = SUPABASE_URL + '/rest/v1/egresos?select=egreso_id,sync_hash&egreso_id=in.(' + ids.join(',') + ')';
      var rCheck = UrlFetchApp.fetch(urlCheck, {
        method: 'get',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
        },
        muteHttpExceptions: true
      });
      var hashMap = {};
      if (rCheck.getResponseCode() === 200) {
        var existentes = JSON.parse(rCheck.getContentText());
        for (var h = 0; h < existentes.length; h++) {
          hashMap[existentes[h].egreso_id] = existentes[h].sync_hash;
        }
      }

      var toUpsert = [];
      for (var j = 0; j < candidatos.length; j++) {
        if (hashMap[candidatos[j].egreso_id] === candidatos[j].sync_hash) {
          saltados++;
        } else {
          toUpsert.push(candidatos[j]);
        }
      }

      if (toUpsert.length > 0) {
        var resp = upsertEgresosBatch(toUpsert);
        if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
          upsertados += toUpsert.length;
        } else {
          Logger.log('Lote de ' + toUpsert.length + ' falló (HTTP ' + resp.getResponseCode() + '). Reintentando individualmente...');
          if (!primerError) primerError = resp.getContentText().substring(0, 200);
          for (var k = 0; k < toUpsert.length; k++) {
            var respInd = upsertEgresosBatch([toUpsert[k]]);
            if (respInd.getResponseCode() >= 200 && respInd.getResponseCode() < 300) {
              upsertados++;
            } else {
              errores++;
              Logger.log('Error individual egreso_id: ' + toUpsert[k].egreso_id + ' -> HTTP ' + respInd.getResponseCode());
            }
          }
        }
      }
    }

    filaInicio = filaFin + 1;
    Utilities.sleep(500);
  }

  if (!interrumpido) {
    props.setProperty('sincEgresos_cursor', String(ultimaFila + 1));
    if (!soloNuevos) {
      props.deleteProperty('sincEgresos_full_idx');
    }
  }

  Logger.log('sincEgresos FIN: upsertados=' + upsertados + ' saltados=' + saltados +
    ' filtrados=' + filtrados + ' omitidos=' + omitidos + ' errores=' + errores +
    ' interrumpido=' + interrumpido +
    (primerError ? ' | Error: ' + primerError : ''));
}

/**
 * Resetea todos los cursores de sincEgresos.
 */
function resetSincEgresosCursor() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('sincEgresos_cursor');
  props.deleteProperty('sincEgresos_cursor_circular');
  props.deleteProperty('sincEgresos_full_idx');
  Logger.log('Todos los cursores de sincEgresos han sido reseteados.');
}

/**
 * Encuentra e inserta solo los egresos faltantes comparando IDs de Sheets vs Supabase.
 */
function sincEgresosFaltantes() {
  var hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_EGRESOS_SINC);
  var ultimaFila = hoja.getLastRow();
  var NUM_COLS_EGR = 23;
  Logger.log('Leyendo ' + (ultimaFila - 1) + ' filas de Egresos...');
  
  var idsSheet = {};
  var datos = hoja.getRange(2, 1, ultimaFila - 1, NUM_COLS_EGR).getValues();
  for (var i = 0; i < datos.length; i++) {
    var id = datos[i][0] ? String(datos[i][0]).trim() : '';
    if (id) idsSheet[id] = i;
  }
  var totalSheet = Object.keys(idsSheet).length;
  Logger.log('IDs únicos en Sheets: ' + totalSheet);
  
  var idsSupabase = {};
  var offset = 0;
  var pageSize = 1000;
  while (true) {
    var url = SUPABASE_URL + '/rest/v1/egresos?select=egreso_id&offset=' + offset + '&limit=' + pageSize;
    var resp = UrlFetchApp.fetch(url, {
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
      muteHttpExceptions: true
    });
    var rows = JSON.parse(resp.getContentText());
    if (rows.length === 0) break;
    for (var j = 0; j < rows.length; j++) {
      if (rows[j].egreso_id) idsSupabase[rows[j].egreso_id] = true;
    }
    offset += pageSize;
    if (rows.length < pageSize) break;
  }
  Logger.log('IDs en Supabase: ' + Object.keys(idsSupabase).length);
  
  var faltantes = [];
  var keys = Object.keys(idsSheet);
  for (var k = 0; k < keys.length; k++) {
    if (!idsSupabase[keys[k]]) {
      faltantes.push(idsSheet[keys[k]]);
    }
  }
  Logger.log('Egresos faltantes: ' + faltantes.length);
  
  if (faltantes.length === 0) {
    Logger.log('No hay egresos faltantes. Todo sincronizado.');
    return;
  }
  
  var batch = [];
  var insertados = 0;
  for (var m = 0; m < faltantes.length; m++) {
    var obj = filaAObjetoSincEgreso(datos[faltantes[m]]);
    if (obj) batch.push(obj);
    if (batch.length >= 50 || m === faltantes.length - 1) {
      if (batch.length > 0) {
        upsertEgresosBatch(batch);
        insertados += batch.length;
        Logger.log('Insertados ' + insertados + ' de ' + faltantes.length);
        batch = [];
      }
    }
  }
  Logger.log('Sincronización de egresos faltantes completada. Total insertados: ' + insertados);
}

/**
 * Alias para webhookAppSheet / pushEgresos
 */
function upsertLoteSincEgresos(lote) {
  var resp = upsertEgresosBatch(lote);
  if (resp && typeof resp.getResponseCode === 'function') {
    resp.code = resp.getResponseCode();
    resp.body = resp.getContentText();
  }
  return resp;
}

