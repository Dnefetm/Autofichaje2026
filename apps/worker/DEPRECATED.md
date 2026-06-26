# apps/worker - DEPRECADO (NO USAR)

> Estado: **RETIRADO**. Este paquete ya no se ejecuta ni se despliega.

## Resumen

El worker standalone que corria en **Render / Docker** fue retirado. Toda la
logica de procesamiento de jobs vive ahora **exclusivamente en Vercel**:

    apps/dashboard/src/app/api/worker/process/route.ts

Invocado cada 1 minuto por **cron-job.org** (safety-net) y por `dispatchWorker()`
de forma inmediata para ordenes.

## Por que se retiro y NO se reactivara

1. **Render Free Tier** apagaba el servicio por inactividad y obligaba a un hack
   de health-check HTTP para mantenerlo "vivo 24/7".
2. **Errores de compilacion sin resolver** (ver `ts-errors.txt`, `ts_errors.txt`,
   `tsc.txt`). El paquete no es desplegable tal cual.
3. Tener la logica de jobs en **dos lugares** (Render + Vercel) duplicaba tokens
   de MeLi y provocaba doble procesamiento / doble conteo.
4. La **fuente unica de verdad** para jobs es ahora el cron de Vercel.

## Que hacer en su lugar

- Para cambiar el comportamiento de cualquier job (`sync_item`, `sync_price`,
  `sync_stock`, `sync_stock_mapped`, `process_sale`, `sync_account_catalog`),
  editar **el route.ts de Vercel**, NO los archivos de este paquete.
- Si en el futuro se necesita sacar la carga de Vercel, **no revivir este codigo**:
  disenar una solucion nueva sobre la version vigente del route.ts.

## Archivos

- `src/index.ts` - neutralizado: sale de inmediato con un warning.
- `src/processor.ts` - conservado solo como referencia historica; no se ejecuta.
