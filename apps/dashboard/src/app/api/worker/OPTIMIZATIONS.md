# Worker — Posibilidades de optimización del procesamiento de jobs

> Documento vivo. Backlog de optimizaciones para el worker (`route.ts`).
> Ultima actualizacion: 2026-06-29.

## Restriccion dura (NO violar)

- **Timeout cron-job.org = 30 segundos** (verificado en el panel, campo "Tiempo de espera agotado"). Si la invocacion tarda mas, cron-job.org corta la conexion y los jobs en vuelo NO se marcan completados -> se vuelven ZOMBIES.
- **Frecuencia minima del cron = 1 minuto** (el dropdown de cron-job.org no ofrece sub-minuto).
- El `maxDuration = 60` de Vercel NO es el techo real; manda el timeout de 30s de cron-job.org.
- Corte interno actual en `route.ts`: aborta el batch a los 25s (`Date.now() - startTimeMs > 25000`). Bien calibrado bajo los 30s. NO subirlo sin cambiar tambien la infra.

## Estado actual (baseline tras el ultimo cambio)

- `BATCH_SIZE = 10` (subido desde 3 el 2026-06-29). Procesamiento SECUENCIAL con delay de 1s entre jobs.
- Duracion de invocacion: ~15-16.5s (margen sano bajo 30s).
- Throughput: ~197 jobs/hora (antes ~30/h). Cero zombies, cero fallidos recientes.
- Rate-limit MeLi medido: 0. Conexiones DB: 15/60.

## Backlog de optimizaciones (orden recomendado: B -> D -> E)

### Opt B — Reducir el delay de 1s entre jobs
Hoy `setTimeout(1000)` entre cada job para no saturar MeLi, pero rate-limit medido = 0. Bajarlo a 300-500ms libera tiempo para mas jobs por invocacion. Riesgo bajo. Validar rate-limit MeLi tras el cambio.

### Opt D — Batch adaptativo por tiempo
En vez de `BATCH_SIZE` fijo, reclamar/procesar jobs MIENTRAS `Date.now()-start < 22s`. Aprovecha toda la ventana dinamicamente. Mas robusto que un numero fijo.

### Opt A — Paralelizar dentro de la ventana
`Promise.all` con concurrencia conservadora (2-3, NO 5), manteniendo corte <25s. Cuidar rate-limit MeLi al perder el delay secuencial. Validar incrementando de a poco.

### Opt C — Multiples crons con offset
Crear 2-3 cron-jobs en cron-job.org al mismo endpoint, desfasados, para simular sub-minuto. Seguro: `claim_jobs` ya usa FOR UPDATE SKIP LOCKED (sin doble-claim).

### Opt E — Arreglar N+1 en handleSyncStock
`calculateAvailableStock` se llama por cada componente en un loop. Batchear esas consultas reduce el tiempo POR job -> mas jobs por ventana.

### Opt F — Upgrade de infra (rompe el techo de 30s)
Vercel Pro (`maxDuration` 300s) + plan de pago en cron-job.org (o Vercel Cron) con timeout mayor. Unica via para superar los 30s. Cuesta dinero; solo si el volumen lo exige.

## Notas / cosas ya descartadas

- Subir `BATCH_SIZE` por encima de ~10 NO es apropiado: a 15 la invocacion roza los ~25s y, con variaciones de hasta 6s, pasaria los 30s -> zombies.
- Bug `bundle_components`: ya resuelto (fallback en `sku-service.ts` que no lanza error). Los errores que se veian son historicos (>7 dias).
- Errores `400` de MeLi: historicos (0 en ultimas 24h). No requieren accion.
