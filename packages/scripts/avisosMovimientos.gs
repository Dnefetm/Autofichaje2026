// =============================================================================
// avisosMovimientos.gs — Registro de movimientos bloqueados por el candado (>30d)
// =============================================================================
// El trigger v135 en Supabase lanza HTTP 400 con mensaje "Movimiento bloqueado...".
// Los syncs (sincIngresos/sincEgresos) capturan ese 400 y llaman a esta función
// para dejar constancia en la tabla avisos_movimientos.
//
// IMPORTANTE: usar EXACTAMENTE los nombres de columna de avisos_movimientos:
//   tabla, operacion, movimiento_id, fecha_movimiento, detalle
// (tabla y operacion son NOT NULL).
// =============================================================================

function registrarAvisoBloqueo(tabla, operacion, movimientoId, fechaMovimiento, detalle) {
  try {
    var payload = {
      tabla: tabla,
      operacion: operacion,
      movimiento_id: movimientoId || null,
      fecha_movimiento: fechaMovimiento || null,
      detalle: detalle || null
    };

    var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/avisos_movimientos', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() >= 300) {
      Logger.log('Aviso NO registrado (HTTP ' + resp.getResponseCode() + '): ' + resp.getContentText().substring(0, 200));
    } else {
      Logger.log('Aviso registrado: ' + tabla + ' | ' + operacion + ' | ' + movimientoId);
    }
  } catch (e) {
    Logger.log('Error registrando aviso de bloqueo: ' + e);
  }
}
