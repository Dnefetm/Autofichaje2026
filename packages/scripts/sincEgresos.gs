// =============================================================================
// sincEgresos.gs — Ventana Activa Única (Sheets → Supabase)
// =============================================================================
// Regla de oro: Sheets y Supabase solo sincronizan la ventana viva (últimos
// 30 días). El pasado es inmutable (candado v135). La Banda 2 (barrido circular
// histórico desde fila 2) fue ELIMINADA: no tiene sentido auditar 71k filas de
// 2021-2025 si el candado de Postgres va a rechazar cualquier cambio >30 días.
//   - Ventana Activa: últimas 500 filas (se insertan al final), descartando en
//     memoria todo lo >30 días.
//   - Comparación Idempotente por Hash (fecha normalizada a epoch ms/UTC).
//   - Un fallo de lote se loguea local (Logger.log), sin reintento individual
//     ni escritura en avisos_movimientos.
// =============================================================================

var HOJA_EGRESOS_SINC = 'Egresos';
var BATCH_SIZE_SINC_EGR = 50;
var CHUNK_HASH_EGRESOS = 40; // blindaje "UrlFetch URL Length" en in.(...)

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
  // Estado del envío Full (antes NO se sincronizaba → incoherencia Sheets vs Supabase)
  var edo_reunido = datos.length > 19 && datos[19] ? String(datos[19]).trim() : null;
  var fecha_reunido = datos.length > 20 ? parseFechaSincEgr(datos[20]) : null;
  var fecha_preparado = datos.length > 21 ? parseFechaSincEgr(datos[21]) : null;

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
    edo_reunido: edo_reunido,
    fecha_reunido: fecha_reunido,
    fecha_preparado: fecha_preparado,
    origin: 'sheets'
  };

  // Hash sobre epoch ms (timezone-agnóstico): evita re-upserts fantasma por el
  // cambio de horario de verano de México (abolido en 2022).
  var fechaEpoch = fecha ? String(new Date(fecha).getTime()) : '';
  var fechaReunidoEpoch = fecha_reunido ? String(new Date(fecha_reunido).getTime()) : '';
  var fechaPreparadoEpoch = fecha_preparado ? String(new Date(fecha_preparado).getTime()) : '';

  var hashStr = egreso_id + '|' + articulo_id + '|' + cant + '|' +
    (guia || '') + '|' + (transportista || '') + '|' + (tipo_egreso || '') + '|' +
    (notas || '') + '|' + fechaEpoch + '|' + (operador_id || '') + '|' +
    (importacion_full_id || '') + '|' + (largo || '') + '|' + (ancho || '') + '|' +
    (alto || '') + '|' + (peso || '') + '|' + (edo_reunido || '') + '|' +
    fechaReunidoEpoch + '|' + fechaPreparadoEpoch;
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
 * Ejecuta SOLO la Ventana Activa (últimas 500 filas). El barrido circular
 * histórico fue eliminado: el candado v135 hace inmutable todo >30 días.
 */
function sincEgresos() {
  Logger.log('>>> INICIANDO SINCRONIZACIÓN VENTANA ACTIVA DE EGRESOS <<<');
  
  // Solo Ventana Activa (últimas 500 filas). La Banda 2 (barrido circular
  // histórico desde fila 2) fue eliminada: el candado v135 hace inmutable
  // todo movimiento >30 días, así que auditar 2021-2025 es cuota desperdiciada.
  sincEgresosVentanaActiva(500);
  
  Logger.log('>>> FIN DE SINCRONIZACIÓN VENTANA ACTIVA <<<');
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
 * Motor de procesamiento por rango con verificación idempotente de hash.
 * Descarta en memoria (0 HTTP) todo movimiento >30 días (candado v135).
 * Hash-check en lotes de CHUNK_HASH_EGRESOS para no exceder la URL.
 * Sin reintento individual ni avisos de red: fallo de lote se loguea local.
 */
function sincEgresosRango_(rangoInicio, rangoFin) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS_SINC);
  if (!hoja) return;

  var filaActual = rangoInicio;
  var upsertados = 0, saltados = 0, filtrados = 0, omitidos = 0, errores = 0, primerError = '';
  var NUM_COLS = 23;
  var corte30 = Date.now() - 30 * 24 * 60 * 60 * 1000;

  while (filaActual <= rangoFin) {
    var filaLoteFin = Math.min(filaActual + BATCH_SIZE_SINC_EGR - 1, rangoFin);
    var cantidadFilas = filaLoteFin - filaActual + 1;
    var datos = hoja.getRange(filaActual, 1, cantidadFilas, NUM_COLS).getValues();
    var candidatos = [];

    for (var i = 0; i < datos.length; i++) {
      var obj = filaAObjetoSincEgreso(datos[i]);
      if (!obj) { omitidos++; continue; }
      // Descartar en memoria (0 HTTP): el candado v135 bloquea >30 días.
      if (obj.fecha) {
        var fEpoch = new Date(obj.fecha).getTime();
        if (!isNaN(fEpoch) && fEpoch < corte30) { filtrados++; continue; }
      }
      candidatos.push(obj);
    }

    if (candidatos.length > 0) {
      // Hash-check en lotes de 40 (blindaje "UrlFetch URL Length").
      var hashMap = {};
      for (var c = 0; c < candidatos.length; c += CHUNK_HASH_EGRESOS) {
        var loteIds = candidatos.slice(c, c + CHUNK_HASH_EGRESOS).map(function(x) { return x.egreso_id; });
        var urlCheck = SUPABASE_URL + '/rest/v1/egresos?select=egreso_id,sync_hash&egreso_id=in.(' + loteIds.join(',') + ')';
        var rCheck = UrlFetchApp.fetch(urlCheck, {
          method: 'get',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
          },
          muteHttpExceptions: true
        });
        if (rCheck.getResponseCode() === 200) {
          var existentes = JSON.parse(rCheck.getContentText());
          for (var h = 0; h < existentes.length; h++) {
            hashMap[existentes[h].egreso_id] = existentes[h].sync_hash;
          }
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
          errores += toUpsert.length;
          if (!primerError) primerError = resp.getContentText().substring(0, 200);
          Logger.log('Lote falló (HTTP ' + resp.getResponseCode() + '): ' + resp.getContentText().substring(0, 300));
        }
      }
    }

    filaActual = filaLoteFin + 1;
    Utilities.sleep(150);
  }

  Logger.log('Rango ' + rangoInicio + '-' + rangoFin + ' RESUMEN: upsertados=' + upsertados +
    ' saltados=' + saltados + ' filtrados=' + filtrados + ' omitidos=' + omitidos + ' errores=' + errores +
    (primerError ? ' | Error: ' + primerError : ''));
}

/**
 * sincEgresos_full() — se conserva por compatibilidad, pero ya NO barre el histórico.
 * Equivale a sincEgresos(): el pasado >30 días es inmutable (candado v135).
 */
function sincEgresos_full() {
  sincEgresos();
}

function sincEgresosPorFecha(soloNuevos) {
  // Legacy: re-envía solo la ventana viva (últimos 30 días). El parámetro soloNuevos
  // se ignora; el filtro por fecha se aplica en memoria dentro de sincEgresosRango_.
  sincEgresos();
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

