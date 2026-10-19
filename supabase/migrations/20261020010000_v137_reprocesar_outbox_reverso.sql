-- v137: desbloqueo del camino reverso (Supabase -> Sheets/AppSheet).
--
-- Contexto: sincSupabaseASheets.gs construia la URL de lectura con TODAS las
-- claves en un solo `in.(...)`. Con 283 egresos de id compuesto (~30 chars),
-- la URL pasaba de ~2048 chars (limite de UrlFetchApp) y Google lanzaba
-- "Limit Exceeded: URLFetch URL Length". El reverso marco esas filas como
-- 'error' y `leerOutboxPendiente` solo lee 'pendiente', asi que quedaron
-- congeladas: los egresos creados en la web nunca bajaron a Sheets/AppSheet.
--
-- Fixes en codigo (ya aplicados en el repo):
--   1. Chunking en leerFilasSupabase (lotes de 40 claves).
--   2. reactivarErroresReverso(): reintenta 'error' -> 'pendiente' (max 3 intentos).
--   3. crearTriggerReverso() en triggerPeriodico.gs (reverso cada 5 min).
--
-- Este SQL reactiva manualmente las filas atascadas (0 intentos, estado 'error').
-- Es idempotente: si ya no hay 'error', no toca nada. Seguro re-ejecutar.

UPDATE public.sync_outbox
SET estado = 'pendiente',
    error = NULL,
    intentos = 0
WHERE estado = 'error'
  AND intentos < 3;
