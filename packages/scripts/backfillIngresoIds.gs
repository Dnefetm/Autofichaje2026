// backfillIngresoIds.gs
// Propósito: Poblar columna ingreso_id en Supabase con el UNIQUEID de AppSheet (Col A de Sheets).
// Match por 5 campos para garantizar unicidad. Idempotente (filtra WHERE ingreso_id IS NULL).
//
// CUÁNDO EJECUTAR: Una sola vez, después de crear la columna ingreso_id en Supabase.
// PREREQUISITO: La columna ingreso_id ya existe en la tabla ingresos.
//
// MATCH: articulo_id + cantidad + fecha + guia + tipo_ingreso + ingreso_id=is.null
// Si hay ambigüedad (0 o >1 filas afectadas), se loguea para revisión manual.

const HOJA_INGRESOS_BACKFILL = 'Ingresos';
const BATCH_SIZE_BACKFILL_ING = 50; // lotes pequeños por la complejidad de las URLs

function parseFechaBackfillIngreso(valor) {
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

function backfillIngresoIds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_INGRESOS_BACKFILL);
  if (!hoja) { Logger.log('ERROR: Hoja "' + HOJA_INGRESOS_BACKFILL + '" no encontrada.'); return; }

  var ultimaFila = hoja.getLastRow();
  Logger.log('Total filas en hoja: ' + (ultimaFila - 1));

  var actualizados = 0, sinMatch = 0, ambiguos = 0, omitidos = 0, errores = 0;

  for (var fila = 2; fila <= ultimaFila; fila += BATCH_SIZE_BACKFILL_ING) {
    var filaFin = Math.min(fila + BATCH_SIZE_BACKFILL_ING - 1, ultimaFila);
    var datos = hoja.getRange(fila, 1, filaFin - fila + 1, 13).getValues();

    for (var i = 0; i < datos.length; i++) {
      var ingresoId = datos[i][0] ? String(datos[i][0]).trim() : '';
      var articuloId = datos[i][2] ? String(datos[i][2]).trim() : '';   // Col C
      var cantidad   = datos[i][3] ? parseInt(datos[i][3], 10) : null; // Col D
      var guia       = datos[i][4] ? String(datos[i][4]).trim() : '';   // Col E
      var tipoIngreso= datos[i][6] ? String(datos[i][6]).trim() : '';   // Col G
      var fecha      = parseFechaBackfillIngreso(datos[i][8]);           // Col I

      if (!ingresoId || !articuloId || !fecha) { omitidos++; continue; }

      // Construir URL con todos los campos para minimizar ambigüedad
      var url = SUPABASE_URL + '/rest/v1/ingresos?' +
        'articulo_id=eq.' + encodeURIComponent(articuloId) +
        '&cantidad=eq.' + (isNaN(cantidad) ? 0 : cantidad) +
        '&fecha=eq.' + encodeURIComponent(fecha) +
        (guia ? '&guia=eq.' + encodeURIComponent(guia) : '&guia=is.null') +
        (tipoIngreso ? '&tipo_ingreso=eq.' + encodeURIComponent(tipoIngreso) : '&tipo_ingreso=is.null') +
        '&ingreso_id=is.null'; // solo actualizar filas sin ID (idempotente)

      var options = {
        method: 'patch',
        contentType: 'application/json',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Prefer': 'return=representation,count=exact'
        },
        payload: JSON.stringify({ ingreso_id: ingresoId }),
        muteHttpExceptions: true
      };

      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();

      if (code >= 200 && code < 300) {
        var resultado = JSON.parse(response.getContentText());
        var count = resultado ? resultado.length : 0;
        if (count === 0) {
          sinMatch++;
          Logger.log('SIN MATCH fila ' + (fila + i) + ': ' + articuloId + ' @ ' + fecha);
        } else if (count > 1) {
          ambiguos++;
          Logger.log('WARNING AMBIGUO fila ' + (fila + i) + ': ' + count + ' filas actualizadas para ' + articuloId);
          actualizados += count;
        } else {
          actualizados++;
        }
      } else {
        errores++;
        if (errores <= 5) Logger.log('ERROR fila ' + (fila + i) + ': HTTP ' + code + ' — ' + response.getContentText().substring(0, 200));
      }

      Utilities.sleep(100);
    }

    Logger.log('Progreso: fila ' + filaFin + '/' + ultimaFila +
      ' | OK:' + actualizados + ' SinMatch:' + sinMatch +
      ' Ambiguos:' + ambiguos + ' Skip:' + omitidos + ' Err:' + errores);
  }

  Logger.log('=== BACKFILL ingreso_id FINAL ===');
  Logger.log('Actualizados: ' + actualizados);
  Logger.log('Sin match (no encontrado en Supabase): ' + sinMatch);
  Logger.log('Ambiguos (>1 fila actualizada): ' + ambiguos);
  Logger.log('Omitidos (sin ingresoId/articuloId/fecha): ' + omitidos);
  Logger.log('Errores HTTP: ' + errores);
}
