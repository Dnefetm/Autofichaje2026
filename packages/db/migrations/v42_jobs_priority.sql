-- ═══════════════════════════════════════════════════════════════════
-- v42 — jobs: columna priority + índice + claim_jobs actualizado
-- ═══════════════════════════════════════════════════════════════════
--
-- PROBLEMA:
--   Los inserts a jobs con el campo `priority` fallaban silenciosamente
--   porque la columna no existía. PostgREST rechaza campos desconocidos
--   con HTTP 400 pero el código TypeScript no verificaba el error.
--
-- AFECTADOS:
--   - webhook items → sync_item (priority: 2) → nunca se insertaba
--   - syncCatalogItem transición fulfillment→otro → sync_stock (priority: 1) → nunca se insertaba
--   - syncCatalogBatchFast misma transición → sync_stock (priority: 1) → nunca se insertaba
--
-- CONVENCIÓN DE PRIORIDADES:
--   1 = Alta  (transición de fulfillment, acción urgente)
--   2 = Media (webhook items push)
--   5 = Normal (default — process_sale, sync_stock_mapped, etc.)
--
-- EJECUTAR EN: Supabase SQL Editor — Dashboard > project > SQL Editor
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Agregar columna priority con default 5 (prioridad normal)
--    IF NOT EXISTS evita error si ya se ejecutó manualmente
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 5;

-- 2. Índice parcial sobre jobs pendientes ordenados por prioridad
--    Solo cubre filas con status='pending' → pequeño y preciso
--    Cuando un job pasa a 'processing', sale del índice automáticamente
CREATE INDEX IF NOT EXISTS idx_jobs_pending_priority
    ON jobs (priority ASC, scheduled_at ASC)
    WHERE status = 'pending';

-- 3. Reemplazar claim_jobs para respetar prioridad
--    ANTES: ORDER BY scheduled_at ASC (FIFO puro)
--    AHORA: ORDER BY priority ASC, scheduled_at ASC
--           priority 1 sale antes que priority 5 aunque sea más nuevo
CREATE OR REPLACE FUNCTION claim_jobs(batch_size_limit INT)
RETURNS SETOF jobs AS $$
DECLARE
    claimed_ids UUID[];
BEGIN
    -- Seleccionar y bloquear los jobs pendientes más prioritarios
    -- SKIP LOCKED: si otro worker ya tiene el job, lo salta (safe concurrencia)
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

    -- Salir si no hay nada que procesar
    IF claimed_ids IS NULL OR array_length(claimed_ids, 1) = 0 THEN
        RETURN;
    END IF;

    -- Marcar como 'processing' atómicamente y devolver las filas
    RETURN QUERY
    UPDATE jobs
    SET
        status       = 'processing',
        processed_at = now()
    WHERE id = ANY(claimed_ids)
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- 4. Función reaper de zombis
--    Libera jobs que llevan >5 min en 'processing' (Vercel los cortó por timeout)
--    Retorna el número de jobs liberados (para logging en el worker)
CREATE OR REPLACE FUNCTION release_zombie_jobs()
RETURNS integer AS $$
DECLARE
    released integer;
BEGIN
    UPDATE jobs
    SET
        status   = 'pending',
        attempts = COALESCE(attempts, 0) + 1
    WHERE
        status       = 'processing'
        AND processed_at < now() - interval '5 minutes';

    GET DIAGNOSTICS released = ROW_COUNT;
    RETURN released;
END;
$$ LANGUAGE plpgsql;

COMMIT;


-- ═══════════════════════════════════════════════════════
-- VERIFICACIÓN POST-EJECUCIÓN (ejecutar por separado)
-- ═══════════════════════════════════════════════════════

-- 1. Confirmar que la columna existe
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'jobs' AND column_name = 'priority';

-- 2. Confirmar que la función tiene priority en el ORDER BY
-- SELECT prosrc FROM pg_proc WHERE proname = 'claim_jobs';

-- 3. Test: insertar job con priority y verificar que se acepta
-- INSERT INTO jobs (type, payload, status, priority)
-- VALUES ('test_priority', '{"test": true}'::jsonb, 'pending', 2)
-- RETURNING id, type, priority;
-- DELETE FROM jobs WHERE type = 'test_priority';
