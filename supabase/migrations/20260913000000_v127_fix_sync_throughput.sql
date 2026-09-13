-- =============================================================================
-- v127: Fix throughput de sync (cola creciendo sin drenar)
-- Aplicar en Supabase Dashboard -> SQL Editor.
-- =============================================================================
-- 1) claim_jobs: NO cobrar intento al reclamar y priorizar por priority real
--    (orders priority 0 antes que items priority 2), no por antigüedad.
--    Evita las fallas fantasma "Agotados N intentos sin error registrado".
-- 2) release_zombie_jobs: NO cobrar intento al liberar un zombie.
-- 3) orders_v2 y payments: dispatch inmediato (MeLi manda orders_v2, no orders).
-- =============================================================================

-- 1) claim_jobs sin incremento de attempts + orden por priority
CREATE OR REPLACE FUNCTION claim_jobs(batch_size_limit INT)
RETURNS SETOF jobs AS $$
DECLARE
    claimed_ids UUID[];
BEGIN
    SELECT array_agg(id) INTO claimed_ids
    FROM (
        SELECT id
        FROM jobs
        WHERE status = 'pending'
          AND scheduled_at <= now()
        ORDER BY priority ASC, scheduled_at ASC
        LIMIT batch_size_limit
        FOR UPDATE SKIP LOCKED
    ) limited_jobs;

    IF claimed_ids IS NULL OR array_length(claimed_ids, 1) = 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE jobs
    SET status = 'processing',
        processed_at = now()
    WHERE id = ANY(claimed_ids)
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- 2) release_zombie_jobs sin incremento de attempts
CREATE OR REPLACE FUNCTION release_zombie_jobs()
RETURNS integer AS $$
DECLARE
    released integer;
BEGIN
    UPDATE jobs
    SET status = 'pending'
    WHERE status = 'processing'
      AND COALESCE(processed_at, scheduled_at, created_at) < now() - interval '5 minutes';
    GET DIAGNOSTICS released = ROW_COUNT;
    RETURN released;
END;
$$ LANGUAGE plpgsql;

-- 3) Órdenes y pagos: dispatch inmediato (descarga las órdenes del cron)
UPDATE public.webhook_config
SET dispatch_immediate = true, window_seconds = 0
WHERE topic IN ('orders_v2', 'payments');
