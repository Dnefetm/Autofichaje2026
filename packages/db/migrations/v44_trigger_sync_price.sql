-- =============================================================================
-- MIGRACIÓN v44: Trigger para encolamiento automático de sync_price
-- =============================================================================
-- PROPÓSITO:
--   Cuando el precio de una publicación se actualiza directamente en Supabase
--   (bulk updates, scripts, o cualquier UPDATE que no pase por el dashboard),
--   encolar automáticamente un job `sync_price` para que el worker lo envíe a MeLi.
--
-- CONTEXTO:
--   - El dashboard ya envía el precio a MeLi síncronamente cuando el usuario edita
--     desde el gestor (PUT /api/catalog/external/[id]/update — route.ts:51-62).
--   - Este trigger cubre el caso de ediciones directas en BD o actualizaciones
--     masivas que no pasen por el dashboard.
--   - El worker activo (route.ts) tiene handleSyncPrice(job) que espera:
--       job.payload = { publicacion_id: UUID }
--     y lee precio_venta de publicaciones_externas directamente.
--   - ON CONFLICT DO NOTHING evita enfilar el mismo job dos veces si se hacen
--     múltiples UPDATEs rápidos antes de que el worker procese.
-- =============================================================================

-- ─── Función ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_encolar_sync_price()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo actuar cuando precio_venta realmente cambió
    IF NEW.precio_venta IS NOT DISTINCT FROM OLD.precio_venta THEN
        RETURN NEW;
    END IF;

    -- No encolar si la publicación tiene sync desactivado
    IF NEW.sync_disabled = TRUE THEN
        RETURN NEW;
    END IF;

    -- No encolar para publicaciones de fulfillment (MeLi gestiona su propio precio)
    IF NEW.logistic_type = 'fulfillment' THEN
        RETURN NEW;
    END IF;

    INSERT INTO jobs (type, payload, status, priority, scheduled_at, created_at)
    VALUES (
        'sync_price',
        jsonb_build_object('publicacion_id', NEW.id),
        'pending',
        5,          -- prioridad estándar (igual que sync_stock_mapped)
        NOW(),
        NOW()
    )
    ON CONFLICT DO NOTHING;  -- evitar duplicados si el job ya está pending

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Trigger ───────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_encolar_sync_price ON publicaciones_externas;

CREATE TRIGGER trg_encolar_sync_price
    AFTER UPDATE OF precio_venta ON publicaciones_externas
    FOR EACH ROW
    EXECUTE FUNCTION fn_encolar_sync_price();

-- ─── Verificación post-aplicación ──────────────────────────────────────────

-- Confirmar que el trigger quedó activo:
-- SELECT tgname, tgrelid::regclass AS tabla, tgenabled
-- FROM pg_trigger
-- WHERE tgname = 'trg_encolar_sync_price';

-- Confirmar que la función existe:
-- SELECT proname, prosrc FROM pg_proc WHERE proname = 'fn_encolar_sync_price';

-- Test manual (simular un cambio de precio):
-- UPDATE publicaciones_externas SET precio_venta = precio_venta + 1 WHERE id = '<uuid>';
-- SELECT type, payload, status FROM jobs WHERE type = 'sync_price' ORDER BY created_at DESC LIMIT 5;
