// triggerPeriodico.gs
// Propósito: Respaldo periódico de sincronización (1 vez por hora).
//
// ARQUITECTURA PUSH-FIRST:
//   El mecanismo primario son los installable triggers de onEdit (pushArticulos.gs):
//     - onEditArticulos(e)  → push inmediato al editar hoja Artículos
//     - onEditIngresos(e)   → push inmediato al editar hoja Ingresos
//     - onEditEgresos(e)    → push inmediato al editar hoja Egresos
//
//   Este timer (1 hora) es la red de seguridad: captura ediciones que el push
//   no alcanzó (fallo HTTP, edición programática de AppSheet, etc.).
//   Con hash V2 en los 3 scripts, el costo del respaldo es mínimo:
//   solo se envían filas que realmente cambiaron.
//
// CUÁNDO EJECUTAR crearTriggerPeriodico():
//   - Una sola vez, después de validar que los pushes funcionan.
//   - Si ya existe un trigger de 15 min: eliminar con eliminarTriggerSinc()
//     y recrear con crearTriggerPeriodico() para actualizar a 1 hora.
//
// FUNCIONES:
//   crearTriggerPeriodico()  — crea el trigger (llamar una sola vez)
//   eliminarTriggerSinc()    — elimina el trigger (emergencia o actualización)
//   verTriggers()            — lista todos los triggers activos del proyecto

// ─────────────────────────────────────────────────────────────────────
// Función principal: sincronización completa (ingresos + egresos)
// Esta función es la que ejecuta el trigger automático
// ─────────────────────────────────────────────────────────────────────
function sincInventarioCompleto() {
  Logger.log('=== sincInventarioCompleto START ' + new Date().toISOString() + ' ===');
  sincIngresos();
  sincEgresos();
  sincArticulos(); // respaldo: solo aplica el UPSERT a filas que cambiaron (V2 con hash)
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
    .everyHours(1)
    .create();

  Logger.log('✅ Trigger creado: sincInventarioCompleto cada 1 hora (respaldo)');
  Logger.log('Mecanismo primario: installable onEdit triggers en pushArticulos.gs');
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
