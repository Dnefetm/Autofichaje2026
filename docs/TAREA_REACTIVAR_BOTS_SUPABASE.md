# TAREA: Reactivar los bots Sync de AppSheet (webhook a Supabase)

**Proyecto:** Autofichaje2026 (app AppSheet "Inventario Selecto MX")
**Estado:** PENDIENTE
**Fecha de creacion:** 2026-07-03
**Prioridad:** Alta (sincronizacion Sheets -> Supabase actualmente pausada)

> ACTUALIZACION 2026-07-11 (evidencia real):
> - SIGUE PENDIENTE Y BLOQUEADA. `SELECT 1;` en SQL Editor responde OK (ts 2026-07-11 21:30 UTC), pero el incidente de plataforma de Supabase "Project status change failures in multiple regions" continua ABIERTO/en monitoreo (ultima actualizacion Jul 10 18:41 UTC). El banner "We are investigating a technical issue" sigue activo en el dashboard.
> - Regla: NO reactivar los 6 bots hasta que el incidente este RESUELTO y el API Gateway confirme 2xx sostenido (no solo un SELECT puntual). Reactivar durante el incidente puede volver a colgar el guardado.
> - Backfill de la ventana pausada pendiente al momento de reactivar (RPC idempotente, no duplica).

---

## Contexto

El 2026-07-03 (~14:00 CST) se **deshabilitaron temporalmente los 6 bots de sincronizacion** de la app AppSheet para desacoplar el webhook a Supabase, porque la instancia de Supabase (`fichas-tecnicas-auto`, plan Free / compute Nano) estaba devolviendo error **HTTP 522 (Connection Timed Out) en el 100% de las peticiones** al API Gateway, lo que hacia que guardar un ingreso/egreso se colgara hasta agotar el timeout (180 s + 3 reintentos).

Efecto de la pausa:
- El registro en **Google Sheets (BD principal) sigue 100% funcional** y sin danos. Los bots solo leian la fila; no escriben en Sheets.
- La sincronizacion espejo hacia **Supabase queda detenida**: los movimientos creados durante la pausa NO llegan a Supabase.

## Bots deshabilitados (a reactivar)

En AppSheet > Automation > Bots:

**Egresos:**
- [ ] Sync Egreso Add
- [ ] Sync Egreso Update
- [ ] Sync Egreso Delete

**Ingresos:**
- [ ] Sync Ingreso Add
- [ ] Sync Ingreso Update
- [ ] Sync Ingreso Delete

(Cada uno dispara un paso HTTP "Call Webhook" hacia `https://ryxdqnzyvnrwalylqyvm.supabase.co/rest/v1/rpc/upsert_egreso` y su equivalente de ingresos.)

## Precondicion para reactivar

- [ ] Supabase de vuelta en estado **Healthy** (no "Checking/Unhealthy").
- [ ] Verificar en el dashboard de Supabase que el API Gateway responde 2xx (Success Rate normal, no 522).
- [ ] Confirmar con `SELECT 1;` en el SQL Editor que la base responde.

## Pasos para reactivar

1. [ ] AppSheet > Automation > Bots.
2. [ ] Por cada uno de los 6 bots: menu ... del bot > **Enable**.
3. [ ] Pulsar **SAVE** en el editor de AppSheet y confirmar que persiste (boton SAVE se desactiva + check verde).
4. [ ] Prueba: crear un ingreso y un egreso de prueba y verificar en Supabase que llegan via `upsert_egreso` / RPC de ingresos.

## Backfill (cerrar la brecha de la ventana pausada)

Los bots NO reenvian retroactivamente lo creado durante la pausa. Al reactivar:

- [ ] Identificar en Google Sheets los ingresos/egresos creados entre **2026-07-03 ~14:00 CST** y el momento de reactivacion.
- [ ] Reenviar esos movimientos al RPC `upsert_egreso` (y equivalente de ingresos). Como el RPC es un **upsert es idempotente**: reenviar no duplica.
- [ ] Validar conteos: filas en Sheets del periodo == filas reflejadas en Supabase.

## Notas / mejora estructural (opcional, ver diagnostico)

- Considerar bajar el timeout del webhook (180 s es excesivo) y/o hacer la sincronizacion realmente asincrona usando el patron `webhook_buffer` como cola, para que un Supabase lento nunca vuelva a frenar el guardado en Sheets.
- Revisar el punto de quiebre ~2026-06-30, cuando el tiempo promedio de los bots salto de ~5-15 s a ~90 s.

## Referencias

- Documento relacionado: `docs/TAREA_REHACER_TRIGGER_APPSSCRIPT.md`
- Documento relacionado: `docs/PLAN_FIX_PRECIOS_PROVEEDOR.md`
