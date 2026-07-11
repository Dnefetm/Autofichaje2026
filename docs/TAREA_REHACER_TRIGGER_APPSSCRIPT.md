# TAREA PENDIENTE: Rehacer el trigger `sincInventarioCompleto` (Apps Script)

> Estado: PENDIENTE
> Fecha de anotacion: 2026-07-03
> Motivo: El activador fue ELIMINADO (no pausado) el 2026-07-03 para detener los correos de fallo "Exceeded maximum execution time" mientras el backend de Supabase esta caido. Apps Script no permite "pausar" un trigger; la unica opcion de la UI es "Borrar activador", por eso se elimino. Hay que recrearlo cuando la DB vuelva a estar Healthy.
> ACTUALIZACION 2026-07-11 (evidencia real): SIGUE PENDIENTE Y BLOQUEADA. `SELECT 1;` responde OK (ts 21:30 UTC) pero el incidente de plataforma Supabase "Project status change failures in multiple regions" continua ABIERTO (ultima actualizacion Jul 10 18:41 UTC) y el banner de incidente sigue en el dashboard. NO recrear el trigger `sincInventarioCompleto` hasta que el incidente este RESUELTO y la DB confirme Healthy sostenido; de lo contrario volveran los correos "Exceeded maximum execution time".


## Contexto
- Proyecto Apps Script: "Exportacion de Inventario"
- Script ID: 1-9rJu3FVVVDmZZYcsTk4_E2nPxpsZBGqMsSp1Ycp-1sxNY74ppkbrz7D
- Documento asociado: "Primer inventario Selecto MX 2026"
- Funcion afectada: sincInventarioCompleto (trabaja en modo incremental con cursor; no duplica ni salta registros al reanudar)
- Trigger que NO se toco (sigue activo, 0% error): onEditSincCambios (al editar la hoja)

## Causa raiz del fallo original (NO era el codigo)
- El script empuja "egresos" al backend via HTTP y recibia HTTP 522 (Cloudflare: origin timeout) en cada request porque la instancia Supabase (proyecto ryxdqnzyvnrwalylqyvm, region us-east-2) esta Unhealthy / ~0% success desde 2026-06-30 por un incidente de plataforma.
- Cada ejecucion consumia el limite de 6 min (360.9s) reintentando 49 items uno por uno -> "Exceeded maximum execution time".
- Mismo origen que: SQL Editor con timeout, egress disparado, worker de Vercel.

## PRECONDICION antes de recrear
- [ ] Confirmar que Supabase esta Healthy: `SELECT 1;` devuelve fila en el SQL Editor.
- [ ] Confirmar que el proyecto ya no marca STATUS Unhealthy ni 0% success.

## PASOS para recrear el trigger
1. [ ] Abrir Apps Script > proyecto "Exportacion de Inventario" > seccion Activadores (icono reloj).
   URL: https://script.google.com/home/projects/1-9rJu3FVVVDmZZYcsTk4_E2nPxpsZBGqMsSp1Ycp-1sxNY74ppkbrz7D/triggers
2. [ ] Clic en "Agregar activador" (boton azul, esquina inferior derecha).
3. [ ] Configurar exactamente como estaba:
   - Funcion a ejecutar: sincInventarioCompleto
   - Implementacion: Encabezado (Head)
   - Origen del evento: Basado en tiempo (Time-driven)
   - Tipo de activador: Temporizador por horas (Hour timer)
   - Intervalo: cada 6 horas (coincide con las ejecuciones originales: 00:46, 06:46, 12:46, 18:46 aprox.)
4. [ ] Guardar.
5. [ ] Ejecutar manualmente una vez sincInventarioCompleto y revisar el Registro de ejecucion: debe COMPLETAR sin HTTP 522 y sin timeout.
6. [ ] Verificar en Activadores que la Tasa de error vuelve a 0%.

## MEJORA recomendada (para que no se repita)
- [ ] En sincInventarioCompleto: detectar respuestas 5xx / 522 y ABORTAR temprano (circuit breaker) en vez de reintentar 49 items uno por uno hasta agotar los 6 min. Asi, si el backend esta caido, la ejecucion falla rapido sin quemar cuota ni generar ruido.

## Verificacion final
- [ ] Un ciclo automatico del trigger completa OK.
- [ ] Dejan de llegar correos de "Exceeded maximum execution time".
