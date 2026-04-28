-- =============================================================================
-- PARCHE P0: Contención de Pérdidas por Bundles (Ejecutar en SQL Editor)
-- =============================================================================

-- 1. Modificamos la función para que multiplique por cantidad_requerida
CREATE OR REPLACE FUNCTION fn_recalcular_precio_marketplace(p_articulo_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_costo_base NUMERIC(12,2);
    v_rule RECORD;
    v_costo_bruto NUMERIC(12,2);
    v_subtotal NUMERIC(12,2);
    v_precio_final NUMERIC(12,2);
    v_margen_percent NUMERIC(5,2);
    v_multiplier INTEGER := 1;
BEGIN
    -- a) Extraer el costo base
    SELECT valor INTO v_costo_base
    FROM costos_articulo
    WHERE articulo_id = p_articulo_id AND vigente = true
    ORDER BY CASE WHEN tipo_costo ILIKE '%menudeo%' THEN 1 ELSE 2 END, valor DESC
    LIMIT 1;

    IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
        RETURN;
    END IF;

    -- b) [PARCHE P0]: Multiplicador de cantidad_requerida para bundles
    SELECT COALESCE(MAX(cantidad_requerida), 1) INTO v_multiplier
    FROM mapeo_publicacion_articulo
    WHERE sku_articulo = p_articulo_id;

    v_costo_base := v_costo_base * v_multiplier;

    -- c) Iterar por reglas
    FOR v_rule IN (
        SELECT r.* 
        FROM pricing_rules r
        WHERE r.is_active = true
    ) LOOP
        v_costo_bruto := v_costo_base * (1 + (COALESCE(v_rule.tax_percentage, 0) / 100.0));
        v_subtotal := v_costo_bruto + COALESCE(v_rule.shipping_cost, 0) + COALESCE(v_rule.ml_fixed_fee, 0);

        IF v_rule.rule_type = 'margin_percentage' THEN
            v_margen_percent := v_rule.value;
            IF (v_rule.ml_commission_percentage + v_margen_percent) >= 100 THEN
                v_precio_final := v_subtotal * 2; 
            ELSE
                v_precio_final := v_subtotal / (1.0 - ((COALESCE(v_rule.ml_commission_percentage, 0) + v_margen_percent) / 100.0));
            END IF;
        ELSE
            IF COALESCE(v_rule.ml_commission_percentage, 0) >= 100 THEN
                v_precio_final := v_subtotal + v_rule.value;
            ELSE
                v_precio_final := (v_subtotal + v_rule.value) / (1.0 - (COALESCE(v_rule.ml_commission_percentage, 0) / 100.0));
            END IF;
        END IF;

        INSERT INTO marketplace_prices (articulo_id, marketplace_id, base_price, sale_price, currency)
        VALUES (p_articulo_id, v_rule.marketplace_id, v_costo_base, ROUND(v_precio_final, 2), 'MXN')
        ON CONFLICT (articulo_id, marketplace_id)
        DO UPDATE SET 
            base_price = EXCLUDED.base_price,
            sale_price = EXCLUDED.sale_price,
            updated_at = now();
    END LOOP;
END;
$$;

-- 2. Recalculamos inmediatamente las 36 publicaciones detectadas por Comet
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT DISTINCT sku_articulo 
        FROM mapeo_publicacion_articulo 
        WHERE cantidad_requerida > 1
    ) LOOP
        PERFORM fn_recalcular_precio_marketplace(r.sku_articulo);
    END LOOP;
END;
$$;

-- 3. Diagnóstico de Cobertura (<5%)
-- Este SELECT te mostrará en el SQL Editor cuántos artículos tienen costo pero no precio
WITH stats AS (
  SELECT 
    (SELECT count(*) FROM articulos) as totales,
    (SELECT count(DISTINCT articulo_id) FROM costos_articulo WHERE vigente = true AND valor > 0) as con_costo,
    (SELECT count(*) FROM marketplace_prices) as con_precio
)
SELECT * FROM stats;
