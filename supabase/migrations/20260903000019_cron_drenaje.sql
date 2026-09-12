-- =============================================================================
-- MIGRACIÓN (append-only) Capa 0 — parte 10: activar cron de drenaje
-- =============================================================================
-- Programa fn_drain_costos_pendientes_sin_match cada 15 minutos.
-- NO autoasigna: solo promueve los costos_pendientes "sin_match" que YA tienen
-- un vínculo manual (alias locked). Requiere la extensión pg_cron.
-- Idempotente (unschedule + schedule). Si pg_cron no está, no hace nada.
-- =============================================================================
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain_costos_15min') THEN
            PERFORM cron.unschedule('drain_costos_15min');
        END IF;
        PERFORM cron.schedule('drain_costos_15min', '*/15 * * * *',
            'SELECT public.fn_drain_costos_pendientes_sin_match()');
    END IF;
END $$;

COMMIT;

-- ROLLBACK:
-- SELECT cron.unschedule('drain_costos_15min');
