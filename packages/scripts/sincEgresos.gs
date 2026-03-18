// sincEgresos.gs
// Propósito: Sync incremental de egresos desde Sheets hacia Supabase.
// Solo envía filas más recientes que el MAX(creado_el) en Supabase.
// Reemplaza migrarEgresosASupabase() para cierres de gap y uso rutinario.
//
// CUÁNDO EJECUTAR:
//   - T3: Para cerrar gap 10-17 mar (primera ejecución)
//   - Periódicamente como respaldo manual
//   - Una vez activos los bots AppSheet (T11), usar solo como respaldo ocasional
//
// TIPOS DE EGRESO normalizados (igual que mapTipoEgreso en MigrarEgresos.gs):
//   'venta' | 'envio_full' | 'devolucion_proveedor' | 'otro'

const HOJA_EGRESOS_SINC = 'Egresos';
const BATCH_SIZE_SINC_EGR = 200;

function parseFechaSincEgreso(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  var str = String(valor).trim();
  if (!str) return null;
  var partes = str.split(' ');
  var fp = partes[0].split('/');
  if (fp.length !== 3) return null;
  var d = new Date(
    fp[2] + '-' + fp[1].padStart(2, '0') + '-' + fp[0].padStart(2, '0') +
    'T' + (partes.length > 1 ? partes[1] : '00:00:00')
  );
  if (isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function mapTipoEgresoSinc(valor) {
  if (!valor) return 'otro';
  var v = String(valor).trim().toLowerCase();
  if (v.indexOf('venta') !== -1) return 'venta';
  if (v.indexOf('full') !== -1 || v.indexOf('fulfillment') !== -1) return 'envio_full';
  if (v.indexOf('devolucion') !== -1 || v.indexOf('devolución') !== -1 ||
      v.indexOf('proveedor') !== -1) return 'devolucion_proveedor';
  return 'otro';
}

function getMaxCreado_elEgresos() {
  var url = SUPABASE_URL + '/rest/v1/egresos?select=creado_el&order=creado_el.desc&limit=1';
  var options = {
    method: 'get',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
    },
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) return null;
  var data = JSON.parse(response.getContentText());
  if (!data || data.length === 0) return null;
  return new Date(data[0].creado_el);
}

function filaAObjetoSincEgreso(fila) {
  // BUG FIX V3: rechazar solo si falta articulo_id
  var art = fila[0] ? String(fila[0]).trim() : '';
  if (!art) return null;

  var cant = fila[3] ? parseInt(fila[3], 10) : 0;
  var tipo = mapTipoEgresoSinc(fila[4]);
  var g    = fila[5] ? String(fila[5]).trim() : null;
  var tr   = fila[6] ? String(fila[6]).trim() : null;
  var no   = fila[7] ? String(fila[7]).trim() : null;
  var fech = parseFechaSincEgreso(fila[8]);
  var op   = fila[9] ? String(fila[9]).trim() : null;

  return {
    articulo_id: art,
    cantidad: isNaN(cant) ? 0 : cant,
    tipo_egreso: tipo,
    guia: g || null,
    transportista: tr || null,
    notas: no || null,
    creado_el: fech || null,
    operador_id: op || null
  };
}

function insertLoteSincEgresos(lote) {
  var url = SUPABASE_URL + '/rest/v1/egresos';
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify(lote),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(url, options);
  return { code: response.getResponseCode(), body: response.getContentText() };
}

function sincEgresos() {
  var maxFechaSupabase = getMaxCreado_elEgresos();
  Logger.log('MAX creado_el en Supabase: ' + (maxFechaSupabase ? maxFechaSupabase.toISOString() : 'ninguna (tabla vacía)'));

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS_SINC);
  if (!hoja) { Logger.log('Hoja "' + HOJA_EGRESOS_SINC + '" no encontrada.'); return; }

  var ultimaFila = hoja.getLastRow();
  var insertados = 0, omitidos = 0, filtrados = 0, errores = 0, primerError = '';

  var filaInicio = 2;
  while (filaInicio <= ultimaFila) {
    var filaFin = Math.min(filaInicio + BATCH_SIZE_SINC_EGR - 1, ultimaFila);
    var datos = hoja.getRange(filaInicio, 1, filaFin - filaInicio + 1, 10).getValues();
    var lote = [];

    for (var i = 0; i < datos.length; i++) {
      var obj = filaAObjetoSincEgreso(datos[i]);
      if (!obj) { omitidos++; continue; }

      // Filtrar solo filas más nuevas que el MAX de Supabase
      if (maxFechaSupabase && obj.creado_el) {
        var fechaFila = new Date(obj.creado_el);
        if (fechaFila <= maxFechaSupabase) { filtrados++; continue; }
      }

      lote.push(obj);
    }

    if (lote.length > 0) {
      var resp = insertLoteSincEgresos(lote);
      if (resp.code >= 300) {
        errores++;
        if (!primerError) primerError = 'Lote en fila ' + filaInicio + ': HTTP ' + resp.code + ' — ' + resp.body;
      } else {
        insertados += lote.length;
      }
    }

    Utilities.sleep(200);
    filaInicio = filaFin + 1;
  }

  Logger.log('=== sincEgresos FINAL ===');
  Logger.log('Insertados: ' + insertados);
  Logger.log('Filtrados (ya en Supabase): ' + filtrados);
  Logger.log('Omitidos (sin articulo_id): ' + omitidos);
  Logger.log('Errores HTTP: ' + errores);
  if (primerError) Logger.log('Primer error: ' + primerError);
}
