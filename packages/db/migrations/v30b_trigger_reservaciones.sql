-- v30b_trigger_reservaciones.sql — Trigger que mantiene reserved_stock sincronizado
-- Depende de: v30a_ordenes.sql, inventory_snapshot (v28a y migraciones anteriores)
--
-- Cada INSERT/UPDATE/DELETE en reservaciones_stock recalcula el campo
-- reserved_stock en inventory_snapshot para el articulo_id afectado.
-- Solo las reservaciones con estado = 'activa' cuentan.
-- Esto se integra limpiamente con calculated_publishable_stock:
--   GREATEST(0, physical_stock + dropship_stock - reserved_stock)

CREATE OR REPLACE FUNCTION fn_sync_reserved_stock()
RETURNS TRIGGER AS $$
DECLARE
    v_articulo_id TEXT;
BEGIN
    -- Determinar qué artículo se afectó
    IF TG_OP = 'DELETE' THEN
        v_articulo_id := OLD.articulo_id;
    ELSE
        v_articulo_id := NEW.articulo_id;
        -- En UPDATE: si cambió el articulo_id, recalcular también el anterior
        IF TG_OP = 'UPDATE' AND OLD.articulo_id IS DISTINCT FROM NEW.articulo_id THEN
            UPDATE inventory_snapshot
            SET reserved_stock = (
                SELECT COALESCE(SUM(cantidad), 0)
                FROM reservaciones_stock
                WHERE articulo_id = OLD.articulo_id
                  AND estado = 'activa'
            ),
            updated_at = now()
            WHERE sku = OLD.articulo_id;
        END IF;
    END IF;

    -- Recalcular reserved_stock para el artículo afectado
    UPDATE inventory_snapshot
    SET reserved_stock = (
        SELECT COALESCE(SUM(cantidad), 0)
        FROM reservaciones_stock
        WHERE articulo_id = v_articulo_id
          AND estado = 'activa'
    ),
    updated_at = now()
    WHERE sku = v_articulo_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_reserved_stock ON reservaciones_stock;
CREATE TRIGGER trg_sync_reserved_stock
    AFTER INSERT OR UPDATE OR DELETE ON reservaciones_stock
    FOR EACH ROW EXECUTE FUNCTION fn_sync_reserved_stock();

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN POST-EJECUCIÓN
-- ══════════════════════════════════════════════════════════════════════
-- SELECT trigger_name, event_object_table, event_manipulation
-- FROM information_schema.triggers
-- WHERE trigger_name = 'trg_sync_reserved_stock';
-- Debe retornar 3 filas (INSERT, UPDATE, DELETE)
