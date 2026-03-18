// sincIngresos.gs
// Propósito: Sync incremental de ingresos desde Sheets hacia Supabase.
// Solo envía filas más recientes que el MAX(fecha) en Supabase.
// Reemplaza migrarIngresosASupabase() para cierres de gap y uso rutinario.
//
// CUÁNDO EJECUTAR:
//   - T3: Para cerrar gap 10-17 mar (primera ejecución)
//   - Periódicamente como respaldo manual (Apps Script incremental)
//   - Una vez activos los bots AppSheet (T11), usar solo como respaldo ocasional
//
// COLUMNAS DE LA HOJA "Ingresos":
//   A: articulo_id | B: numero_ingreso | C: ??? | D: cantidad
//   E: guia | F: transportista | G: tipo_ingreso | H: notas
//   I: fecha | J: operador_id | K,L,M: imagenes
//
// NOTA: Ajustar índices de columna si la hoja real difiere de v13_migration.sql

const HOJA_INGRESOS_SINC = 'Ingresos';
const BATCH_SIZE_SINC_ING = 200;

function parseFechaSincIngreso(valor) {
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

function getMaxFechaIngresos() {
  var url = SUPABASE_URL + '/rest/v1/ingresos?select=fecha&order=fecha.desc&limit=1';
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
  return new Date(data[0].fecha);
}

function filaAObjetoSincIngreso(fila) {
  // BUG FIX V3: rechazar solo si falta articulo_id (permite cantidad=0)
  var art = fila[0] ? String(fila[0]).trim() : '';
  if (!art) return null;

  var cant = fila[3] ? parseInt(fila[3], 10) : 0;
  var g   = fila[4] ? String(fila[4]).trim() : null;
  var tr  = fila[5] ? String(fila[5]).trim() : null;
  var ti  = fila[6] ? String(fila[6]).trim() : null;
  var no  = fila[7] ? String(fila[7]).trim() : null;
  var fe  = parseFechaSincIngreso(fila[8]);
  var op  = fila[9] ? String(fila[9]).trim() : null;
  var imgs = [fila[10], fila[11], fila[12]]
    .map(function(x) { return x ? String(x).trim() : ''; })
    .filter(function(x) { return x !== ''; });

  return {
    articulo_id: art,
    cantidad: isNaN(cant) ? 0 : cant,
    guia: g || null,
    transportista: tr || null,
    tipo_ingreso: ti || null,
    notas: no || null,
    fecha: fe || null,
    operador_id: op || null,
    imagenes: imgs.length > 0 ? imgs : null
  };
}

function insertLoteSincIngresos(lote) {
  var url = SUPABASE_URL + '/rest/v1/ingresos';
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

function sincIngresos() {
  var maxFechaSupabase = getMaxFechaIngresos();
  Logger.log('MAX fecha en Supabase: ' + (maxFechaSupabase ? maxFechaSupabase.toISOString() : 'ninguna (tabla vacía)'));

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_INGRESOS_SINC);
  if (!hoja) { Logger.log('Hoja "' + HOJA_INGRESOS_SINC + '" no encontrada.'); return; }

  var ultimaFila = hoja.getLastRow();
  var insertados = 0, omitidos = 0, filtrados = 0, errores = 0, primerError = '';

  var filaInicio = 2;
  while (filaInicio <= ultimaFila) {
    var filaFin = Math.min(filaInicio + BATCH_SIZE_SINC_ING - 1, ultimaFila);
    var datos = hoja.getRange(filaInicio, 1, filaFin - filaInicio + 1, 13).getValues();
    var lote = [];

    for (var i = 0; i < datos.length; i++) {
      var obj = filaAObjetoSincIngreso(datos[i]);
      if (!obj) { omitidos++; continue; }

      // Filtrar solo filas más nuevas que el MAX de Supabase
      if (maxFechaSupabase && obj.fecha) {
        var fechaFila = new Date(obj.fecha);
        if (fechaFila <= maxFechaSupabase) { filtrados++; continue; }
      }

      lote.push(obj);
    }

    if (lote.length > 0) {
      var resp = insertLoteSincIngresos(lote);
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

  Logger.log('=== sincIngresos FINAL ===');
  Logger.log('Insertados: ' + insertados);
  Logger.log('Filtrados (ya en Supabase): ' + filtrados);
  Logger.log('Omitidos (sin articulo_id): ' + omitidos);
  Logger.log('Errores HTTP: ' + errores);
  if (primerError) Logger.log('Primer error: ' + primerError);
}
