// triggerPeriodico.gs
// Propósito: Crear y gestionar el trigger automático de sincronización.
// Llama a sincIngresos() + sincEgresos() cada 15 minutos como respaldo automático.
//
// CUÁNDO EJECUTAR crearTriggerPeriodico():
//   - Solo después de validar que sincIngresos() y sincEgresos() funcionan correctamente
//     con UPSERT (no crean duplicados, actualizan correctamente).
//
// FUNCIONES:
//   crearTriggerPeriodico()  — crea el trigger (llamar una sola vez)
//   eliminarTriggerSinc()    — elimina el trigger si hay que desactivarlo de emergencia
//   verTriggers()            — lista todos los triggers activos del proyecto

// ─────────────────────────────────────────────────────────────────────
// Función principal: sincronización completa (ingresos + egresos)
// Esta función es la que ejecuta el trigger automático
// ─────────────────────────────────────────────────────────────────────
function sincInventarioCompleto() {
  Logger.log('=== sincInventarioCompleto START ' + new Date().toISOString() + ' ===');
  sincIngresos();
  sincEgresos();
  Logger.log('=== sincInventarioCompleto END ' + new Date().toISOString() + ' ===');
}

// ─────────────────────────────────────────────────────────────────────
// Crear trigger periódico (ejecutar UNA SOLA VEZ)
// ─────────────────────────────────────────────────────────────────────
function crearTriggerPeriodico() {
  // Verificar si ya existe para no duplicar
  var triggers = ScriptApp.getProjectTriggers();
  var yaExiste = false;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'sincInventarioCompleto') {
      yaExiste = true;
      Logger.log('AVISO: Trigger ya existe. ID: ' + t.getUniqueId() +
                 ' | Próxima ejecución no disponible vía API.');
    }
  });

  if (yaExiste) {
    Logger.log('No se creó duplicado. Usar eliminarTriggerSinc() primero si quieres recrearlo.');
    return;
  }

  ScriptApp.newTrigger('sincInventarioCompleto')
    .timeBased()
    .everyMinutes(15)
    .create();

  Logger.log('✅ Trigger creado: sincInventarioCompleto cada 15 minutos');
  Logger.log('Verificar en Apps Script > Activadores que aparece activo.');
}

// ─────────────────────────────────────────────────────────────────────
// Eliminar trigger de emergencia
// ─────────────────────────────────────────────────────────────────────
function eliminarTriggerSinc() {
  var triggers = ScriptApp.getProjectTriggers();
  var eliminados = 0;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'sincInventarioCompleto') {
      ScriptApp.deleteTrigger(t);
      eliminados++;
      Logger.log('Trigger eliminado: ' + t.getUniqueId());
    }
  });
  if (eliminados === 0) Logger.log('No se encontró ningún trigger de sincInventarioCompleto.');
  else Logger.log('Total eliminados: ' + eliminados);
}

// ─────────────────────────────────────────────────────────────────────
// Ver todos los triggers activos del proyecto
// ─────────────────────────────────────────────────────────────────────
function verTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    Logger.log('No hay triggers activos en este proyecto.');
    return;
  }
  triggers.forEach(function(t) {
    Logger.log('Función: ' + t.getHandlerFunction() +
               ' | Tipo: ' + t.getEventType() +
               ' | ID: ' + t.getUniqueId());
  });
}
