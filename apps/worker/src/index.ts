/**
 * ============================================================================
 * [DEPRECADO - NO USAR] Worker standalone (Render / Docker)
 * ============================================================================
 *
 * ESTE WORKER YA NO SE USA Y NO DEBE REACTIVARSE.
 *
 * Toda la logica de procesamiento de jobs (sync_item, sync_price,
 * sync_stock, sync_stock_mapped, process_sale, sync_account_catalog, etc.)
 * vive ahora EXCLUSIVAMENTE en el endpoint de Vercel:
 *
 *     apps/dashboard/src/app/api/worker/process/route.ts
 *
 * invocado cada 1 minuto por cron-job.org (safety-net) y por dispatchWorker()
 * de forma inmediata para ordenes.
 *
 * Razones por las que este worker fue retirado y NO se volvera a usar:
 *   1. Corria en Render Free Tier, que apaga el servicio por inactividad
 *      y obligaba a un hack de health-check HTTP para mantenerlo vivo.
 *   2. Quedo con errores de compilacion sin resolver (ver ts-errors.txt,
 *      ts_errors.txt, tsc.txt en apps/worker/). NO es desplegable tal cual.
 *   3. Mantener la logica de jobs en dos lugares (Render + Vercel) duplicaba
 *      tokens de MeLi y causaba doble procesamiento / doble conteo.
 *   4. La fuente unica de verdad para jobs es ahora Vercel cron.
 *
 * Si en el futuro se necesita sacar la carga de Vercel, NO se revive este
 * codigo: se disena una solucion nueva sobre la version vigente del route.ts.
 *
 * Este archivo se conserva solo como referencia historica. Su main() no
 * arranca ningun procesador ni servidor: sale de inmediato.
 * ============================================================================
 */

console.warn(
  '[apps/worker] DEPRECADO: este worker no se usa. ' +
  'Los jobs se procesan en Vercel (apps/dashboard/src/app/api/worker/process). ' +
  'Saliendo sin hacer nada.'
);

process.exit(0);
