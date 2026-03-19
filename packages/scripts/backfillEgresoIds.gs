// backfillEgresoIds.gs
// Propósito: Poblar columna egreso_id en Supabase con el UNIQUEID de AppSheet (Col A de Sheets).
// Match por 5 campos. Idempotente (filtra WHERE egreso_id IS NULL).
//
// MATCH: articulo_id + cantidad + creado_el + guia + tipo_egreso + egreso_id=is.null

const HOJA_EGRESOS_BACKFILL = 'Egresos';
const BATCH_SIZE_BACKFILL_EGR = 50;

function parseFechaBackfillEgreso(valor) {
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

function mapTipoEgresoBackfill(valor) {
  if (!valor) return null;
  var v = String(valor).trim().toLowerCase();
  if (v.indexOf('venta') !== -1) return 'venta';
  if (v.indexOf('full') !== -1 || v.indexOf('fulfillment') !== -1) return 'envio_full';
  if (v.indexOf('devolucion') !== -1 || v.indexOf('devolución') !== -1 ||
      v.indexOf('proveedor') !== -1) return 'devolucion_proveedor';
  return 'otro';
}

function backfillEgresoIds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS_BACKFILL);
  if (!hoja) { Logger.log('ERROR: Hoja "' + HOJA_EGRESOS_BACKFILL + '" no encontrada.'); return; }

  var ultimaFila = hoja.getLastRow();
  Logger.log('Total filas en hoja: ' + (ultimaFila - 1));

  var actualizados = 0, sinMatch = 0, ambiguos = 0, omitidos = 0, errores = 0;

  for (var fila = 2; fila <= ultimaFila; fila += BATCH_SIZE_BACKFILL_EGR) {
    var filaFin = Math.min(fila + BATCH_SIZE_BACKFILL_EGR - 1, ultimaFila);
    var datos = hoja.getRange(fila, 1, filaFin - fila + 1, 10).getValues();

    for (var i = 0; i < datos.length; i++) {
      var egresoId   = datos[i][0] ? String(datos[i][0]).trim() : '';
      var articuloId = datos[i][2] ? String(datos[i][2]).trim() : '';   // Col C
      var cantidad   = datos[i][3] ? parseInt(datos[i][3], 10) : null; // Col D
      var guia       = datos[i][4] ? String(datos[i][4]).trim() : '';   // Col E
      var tipoEgreso = mapTipoEgresoBackfill(datos[i][6]);              // Col G normalizado
      var fecha      = parseFechaBackfillEgreso(datos[i][8]);           // Col I

      if (!egresoId || !articuloId || !fecha) { omitidos++; continue; }

      var url = SUPABASE_URL + '/rest/v1/egresos?' +
        'articulo_id=eq.' + encodeURIComponent(articuloId) +
        '&cantidad=eq.' + (isNaN(cantidad) ? 0 : cantidad) +
        '&creado_el=eq.' + encodeURIComponent(fecha) +
        (guia ? '&guia=eq.' + encodeURIComponent(guia) : '&guia=is.null') +
        (tipoEgreso ? '&tipo_egreso=eq.' + encodeURIComponent(tipoEgreso) : '&tipo_egreso=is.null') +
        '&egreso_id=is.null';

      var options = {
        method: 'patch',
        contentType: 'application/json',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'Prefer': 'return=representation,count=exact'
        },
        payload: JSON.stringify({ egreso_id: egresoId }),
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
          Logger.log('WARNING AMBIGUO fila ' + (fila + i) + ': ' + count + ' filas para ' + articuloId);
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

  Logger.log('=== BACKFILL egreso_id FINAL ===');
  Logger.log('Actualizados: ' + actualizados);
  Logger.log('Sin match: ' + sinMatch);
  Logger.log('Ambiguos: ' + ambiguos);
  Logger.log('Omitidos: ' + omitidos);
  Logger.log('Errores HTTP: ' + errores);
}
