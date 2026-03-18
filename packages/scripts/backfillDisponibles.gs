// backfillDisponibles.gs
// Propósito: Poblar la columna `disponibles` en Supabase articulos
// con los valores de la columna G ("Disponibles") de la hoja "Artículos" de Sheets.
//
// CUÁNDO EJECUTAR: Una sola vez, después de ejecutar v28a_disponibles.sql en Supabase.
// ANTES de ejecutar el backfill masivo de stock (T6).
//
// La hoja "Artículos" debe tener:
//   Columna A: articulo_id (identificador único del artículo)
//   Columna G: Disponibles (stock base numérico inicial)
//
// Usa las mismas constantes SUPABASE_URL y SUPABASE_SERVICE_KEY definidas globalmente.

const HOJA_ARTICULOS_DISP = 'Artículos';
const BATCH_SIZE_DISP = 200;

function backfillDisponibles() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_ARTICULOS_DISP);
  if (!hoja) {
    Logger.log('ERROR: Hoja "' + HOJA_ARTICULOS_DISP + '" no encontrada.');
    return;
  }

  var ultimaFila = hoja.getLastRow();
  Logger.log('Total filas a procesar: ' + (ultimaFila - 1));

  var actualizados = 0, omitidos = 0, errores = 0, primerError = '';

  for (var fila = 2; fila <= ultimaFila; fila += BATCH_SIZE_DISP) {
    var filaFin = Math.min(fila + BATCH_SIZE_DISP - 1, ultimaFila);
    var datos = hoja.getRange(fila, 1, filaFin - fila + 1, 7).getValues(); // cols A-G

    for (var i = 0; i < datos.length; i++) {
      var articuloId = datos[i][0] ? String(datos[i][0]).trim() : '';
      var disponiblesVal = datos[i][6]; // columna G (índice 6)

      if (!articuloId) { omitidos++; continue; }

      var disp = parseInt(disponiblesVal, 10);
      if (isNaN(disp)) disp = 0;

      var url = SUPABASE_URL + '/rest/v1/articulos?articulo_id=eq.' + encodeURIComponent(articuloId);
      var options = {
        method: 'patch',
        contentType: 'application/json',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Prefer': 'return=minimal'
        },
        payload: JSON.stringify({ disponibles: disp }),
        muteHttpExceptions: true
      };

      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();

      if (code >= 200 && code < 300) {
        actualizados++;
      } else {
        errores++;
        if (!primerError) {
          primerError = 'Fila ' + (fila + i) + ' (' + articuloId + '): HTTP ' + code + ' — ' + response.getContentText();
        }
      }

      Utilities.sleep(50); // evitar rate limit
    }

    Logger.log('Progreso: fila ' + filaFin + '/' + ultimaFila +
      ' | OK: ' + actualizados +
      ' | Skip: ' + omitidos +
      ' | Err: ' + errores);
  }

  Logger.log('=== BACKFILL DISPONIBLES FINAL ===');
  Logger.log('Actualizados: ' + actualizados);
  Logger.log('Omitidos (sin articulo_id): ' + omitidos);
  Logger.log('Errores HTTP: ' + errores);
  if (primerError) Logger.log('Primer error: ' + primerError);
}

// Para prueba con una sola fila antes del backfill completo:
function testBackfillDisponiblesFila2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_ARTICULOS_DISP);
  if (!hoja) { Logger.log('Hoja no encontrada'); return; }
  var fila = hoja.getRange(2, 1, 1, 7).getValues()[0];
  var articuloId = fila[0] ? String(fila[0]).trim() : '';
  var disp = parseInt(fila[6], 10) || 0;
  Logger.log('articulo_id: ' + articuloId + ' | disponibles: ' + disp);

  var url = SUPABASE_URL + '/rest/v1/articulos?articulo_id=eq.' + encodeURIComponent(articuloId);
  var options = {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify({ disponibles: disp }),
    muteHttpExceptions: true
  };
  var r = UrlFetchApp.fetch(url, options);
  Logger.log('HTTP ' + r.getResponseCode() + ': ' + r.getContentText());
}
