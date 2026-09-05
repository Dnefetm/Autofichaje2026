// MigrarIngresos.gs - Paso 4.1
const HOJA_INGRESOS = 'Ingresos';
const BATCH_SIZE_ING = 200;

function parseFechaIngreso(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  var str = String(valor).trim();
  if (!str) return null;
  var partes = str.split(' ');
  var fp = partes[0].split('/');
  if (fp.length !== 3) return null;
  var d = new Date(fp[2] + '-' + fp[1].padStart(2,'0') + '-' + fp[0].padStart(2,'0') + 'T' + (partes.length > 1 ? partes[1] : '00:00:00'));
  if (isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function filaAObjetoIngreso(fila) {
  var art = fila[2] ? String(fila[2]).trim() : '';
  var cant = fila[3] ? parseInt(fila[3], 10) : 0;
  if (!art && !cant) return null;
  var g = fila[4] ? String(fila[4]).trim() : '';
  var tr = fila[5] ? String(fila[5]).trim() : '';
  var ti = fila[6] ? String(fila[6]).trim() : '';
  var no = fila[7] ? String(fila[7]).trim() : '';
  var fe = parseFechaIngreso(fila[8]);
  var op = fila[9] ? String(fila[9]).trim() : '';
  var imgs = [fila[10],fila[11],fila[12]].map(function(x){return x?String(x).trim():'';}).filter(function(x){return x!=='';});
  return {
    articulo_id: art || null,
    cantidad: cant || 0,
    guia: g || null,
    transportista: tr || null,
    tipo_ingreso: ti || null,
    notas: no || null,
    fecha: fe || null,
    operador_id: op || null,
    imagenes: imgs.length > 0 ? imgs : null
  };
}

function insertLoteIngresos(lote) {
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

function migrarIngresosASupabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_INGRESOS);
  if (!hoja) { Logger.log('Hoja no encontrada'); return; }
  var ultimaFila = hoja.getLastRow();
  Logger.log('Total filas: ' + (ultimaFila - 1));
  var insertados = 0, omitidos = 0, erroresHTTP = 0, primerError = '';
  var filaInicio = 2;
  while (filaInicio <= ultimaFila) {
    var filaFin = Math.min(filaInicio + BATCH_SIZE_ING - 1, ultimaFila);
    var datos = hoja.getRange(filaInicio, 1, filaFin - filaInicio + 1, 13).getValues();
    var lote = [];
    for (var i = 0; i < datos.length; i++) {
      var obj = filaAObjetoIngreso(datos[i]);
      if (obj) lote.push(obj); else omitidos++;
    }
    if (lote.length > 0) {
      var r = insertLoteIngresos(lote);
      if (r.code >= 200 && r.code < 300) {
        insertados += lote.length;
      } else if (r.code === 429) {
        Logger.log('Rate limited at row ' + filaInicio + ', sleeping 5s...');
        Utilities.sleep(5000);
        r = insertLoteIngresos(lote);
        if (r.code >= 200 && r.code < 300) {
          insertados += lote.length;
        } else {
          erroresHTTP++;
          if (!primerError) primerError = 'Filas ' + filaInicio + ': ' + r.code + ' ' + r.body;
          Logger.log('ERROR ' + filaInicio + ': ' + r.code + ' ' + r.body);
        }
      } else {
        erroresHTTP++;
        if (!primerError) primerError = 'Filas ' + filaInicio + ': ' + r.code + ' ' + r.body;
        Logger.log('ERROR ' + filaInicio + ': ' + r.code + ' ' + r.body);
        // CIRCUIT BREAKER (2026-07-04): backend caido (5xx/522) -> abortar el bucle.
if (r.code >= 500) {
Logger.log('CIRCUIT BREAKER: HTTP ' + r.code + ' - backend caido. Se aborta migrarIngresos.');
break;
}
      }
    }
    if ((filaInicio - 2) % 2000 === 0 || filaFin === ultimaFila) {
      Logger.log('Progreso: ' + filaInicio + '/' + ultimaFila + ' | OK:' + insertados + ' Skip:' + omitidos + ' Err:' + erroresHTTP);
    }
    Utilities.sleep(200);
    filaInicio = filaFin + 1;
  }
  Logger.log('=== FINAL: Insertados=' + insertados + ' Omitidos=' + omitidos + ' Errores=' + erroresHTTP);
  if (primerError) Logger.log('Primer error: ' + primerError);
}

function testMigrarPrimeraFilaIngreso() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_INGRESOS);
  if (!hoja) { Logger.log('Hoja no encontrada'); return; }
  var fila = hoja.getRange(2, 1, 1, 13).getValues()[0];
  var obj = filaAObjetoIngreso(fila);
  Logger.log('Objeto: ' + JSON.stringify(obj, null, 2));
  if (!obj) return;
  var r = insertLoteIngresos([obj]);
  Logger.log('Resultado: ' + JSON.stringify(r));
}