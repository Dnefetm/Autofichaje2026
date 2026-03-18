-- Migración V28b — Función fn_recalcular_stock
-- Propósito: Recalcular physical_stock en inventory_snapshot para un artículo.
-- Fórmula: disponibles + SUM(ingresos) - SUM(egresos)
--
-- PREREQUISITOS:
--   1. v28a_disponibles.sql ejecutado y disponibles poblado con backfillDisponibles()
--   2. ingresos/egresos con gap 10-17 mar cerrado (sincIngresos/sincEgresos ejecutados)
--
-- Esta función es llamada por los triggers de v29_triggers_stock.sql (artículo por artículo).
-- El backfill masivo usa un UPDATE con JOINs más eficiente (ver task.md T6).
--
-- NOTA: decrement_stock_safe e inventory_transactions NO se tocan.
-- Los triggers NO escriben en inventory_transactions.

CREATE OR REPLACE FUNCTION fn_recalcular_stock(p_articulo_id TEXT)
RETURNS void AS $$
DECLARE
    v_disponibles    INTEGER;
    v_total_ingresos INTEGER;
    v_total_egresos  INTEGER;
BEGIN
    -- Stock base del artículo
    SELECT COALESCE(disponibles, 0)
    INTO v_disponibles
    FROM articulos
    WHERE articulo_id = p_articulo_id;

    -- Total de ingresos históricos
    SELECT COALESCE(SUM(cantidad), 0)
    INTO v_total_ingresos
    FROM ingresos
    WHERE articulo_id = p_articulo_id;

    -- Total de egresos históricos
    SELECT COALESCE(SUM(cantidad), 0)
    INTO v_total_egresos
    FROM egresos
    WHERE articulo_id = p_articulo_id;

    -- Actualizar snapshot (nunca negativo)
    UPDATE inventory_snapshot
    SET physical_stock = GREATEST(0, v_disponibles + v_total_ingresos - v_total_egresos),
        updated_at     = NOW()
    WHERE sku = p_articulo_id;

END;
$$ LANGUAGE plpgsql;

-- Verificación: ejecutar para un artículo conocido y comparar con AppSheet
-- SELECT fn_recalcular_stock('ARTICULO_ID_TEST');
-- SELECT sku, physical_stock FROM inventory_snapshot WHERE sku = 'ARTICULO_ID_TEST';
