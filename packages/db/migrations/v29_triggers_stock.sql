-- Migración V29 — Triggers de sincronización de stock
-- Propósito: Recalcular physical_stock automáticamente en inventory_snapshot
-- cada vez que se inserta, modifica o elimina un ingreso o egreso.
--
-- PREREQUISITO: v28b_fn_recalcular_stock.sql ejecutado.
--
-- 6 triggers en total: INSERT/UPDATE/DELETE × ingresos + egresos
-- NOTA: Los triggers NO escriben en inventory_transactions.
--       decrement_stock_safe se conserva intacta para uso futuro.

-- ══════════════════════════════════════════════════════════════════════
-- FUNCIÓN DE TRIGGER (compartida por los 6 triggers)
-- ══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION trg_fn_sync_stock()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        -- Artículo eliminado: recalcular su stock
        IF OLD.articulo_id IS NOT NULL THEN
            PERFORM fn_recalcular_stock(OLD.articulo_id);
        END IF;

    ELSIF TG_OP = 'UPDATE' THEN
        -- Si cambió el articulo_id, recalcular AMBOS (artículo viejo y nuevo)
        IF OLD.articulo_id IS DISTINCT FROM NEW.articulo_id THEN
            IF OLD.articulo_id IS NOT NULL THEN
                PERFORM fn_recalcular_stock(OLD.articulo_id);
            END IF;
        END IF;
        IF NEW.articulo_id IS NOT NULL THEN
            PERFORM fn_recalcular_stock(NEW.articulo_id);
        END IF;

    ELSE -- INSERT
        IF NEW.articulo_id IS NOT NULL THEN
            PERFORM fn_recalcular_stock(NEW.articulo_id);
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════════════
-- TRIGGERS EN INGRESOS
-- ══════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_stock_after_insert_ingreso ON ingresos;
CREATE TRIGGER trg_stock_after_insert_ingreso
    AFTER INSERT ON ingresos
    FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_stock();

DROP TRIGGER IF EXISTS trg_stock_after_update_ingreso ON ingresos;
CREATE TRIGGER trg_stock_after_update_ingreso
    AFTER UPDATE ON ingresos
    FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_stock();

DROP TRIGGER IF EXISTS trg_stock_after_delete_ingreso ON ingresos;
CREATE TRIGGER trg_stock_after_delete_ingreso
    AFTER DELETE ON ingresos
    FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_stock();

-- ══════════════════════════════════════════════════════════════════════
-- TRIGGERS EN EGRESOS
-- ══════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_stock_after_insert_egreso ON egresos;
CREATE TRIGGER trg_stock_after_insert_egreso
    AFTER INSERT ON egresos
    FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_stock();

DROP TRIGGER IF EXISTS trg_stock_after_update_egreso ON egresos;
CREATE TRIGGER trg_stock_after_update_egreso
    AFTER UPDATE ON egresos
    FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_stock();

DROP TRIGGER IF EXISTS trg_stock_after_delete_egreso ON egresos;
CREATE TRIGGER trg_stock_after_delete_egreso
    AFTER DELETE ON egresos
    FOR EACH ROW EXECUTE FUNCTION trg_fn_sync_stock();

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN POST-EJECUCIÓN (deben aparecer 6 triggers)
-- ══════════════════════════════════════════════════════════════════════
-- SELECT trigger_name, event_object_table, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE trigger_name LIKE 'trg_stock%'
-- ORDER BY event_object_table, event_manipulation;

-- ══════════════════════════════════════════════════════════════════════
-- T6 — BACKFILL MASIVO (ejecutar separado, después de poblar disponibles)
-- ══════════════════════════════════════════════════════════════════════
-- Este bloque NO se ejecuta automáticamente con el script.
-- Se copia y ejecuta POR SEPARADO en el SQL Editor de Supabase.
-- Requiere que disponibles ya esté poblado desde Sheets (backfillDisponibles).
--
-- UPDATE inventory_snapshot s
-- SET
--     physical_stock = GREATEST(0,
--         COALESCE(a.disponibles, 0)
--         + COALESCE(i.total, 0)
--         - COALESCE(e.total, 0)),
--     updated_at = NOW()
-- FROM articulos a
-- LEFT JOIN (
--     SELECT articulo_id, SUM(cantidad) AS total
--     FROM ingresos GROUP BY articulo_id
-- ) i ON i.articulo_id = a.articulo_id
-- LEFT JOIN (
--     SELECT articulo_id, SUM(cantidad) AS total
--     FROM egresos GROUP BY articulo_id
-- ) e ON e.articulo_id = a.articulo_id
-- WHERE s.sku = a.articulo_id;
