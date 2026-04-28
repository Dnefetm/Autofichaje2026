-- =============================================================================
-- MIGRACIÓN v86: Parche Quirúrgico P0 (Evitar pérdidas en bundles)
-- =============================================================================

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
    -- a) Extraer el costo base (prioridad: menudeo > cualquier otro vigente > 0)
    SELECT valor INTO v_costo_base
    FROM costos_articulo
    WHERE articulo_id = p_articulo_id AND vigente = true
    ORDER BY CASE WHEN tipo_costo ILIKE '%menudeo%' THEN 1 ELSE 2 END, valor DESC
    LIMIT 1;

    IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
        RETURN; -- No hay costo para recalcular
    END IF;

    -- [PARCHE P0]: Multiplicador de cantidad_requerida para bundles
    -- Si el artículo pertenece a un bundle que requiere >1 cantidad, multiplicamos el costo base
    SELECT COALESCE(MAX(cantidad_requerida), 1) INTO v_multiplier
    FROM mapeo_publicacion_articulo
    WHERE sku_articulo = p_articulo_id;

    -- Multiplicar costo base
    v_costo_base := v_costo_base * v_multiplier;

    -- b) Iterar por los marketplaces (reglas activas) para este artículo
    FOR v_rule IN (
        SELECT r.* 
        FROM pricing_rules r
        WHERE r.is_active = true
    ) LOOP
        -- Fórmula: 
        v_costo_bruto := v_costo_base * (1 + (COALESCE(v_rule.tax_percentage, 0) / 100.0));
        
        v_subtotal := v_costo_bruto + COALESCE(v_rule.shipping_cost, 0) + COALESCE(v_rule.ml_fixed_fee, 0);

        -- Extraer Margen
        IF v_rule.rule_type = 'margin_percentage' THEN
            v_margen_percent := v_rule.value;
            
            -- Evitar división por cero o negativa
            IF (v_rule.ml_commission_percentage + v_margen_percent) >= 100 THEN
                v_precio_final := v_subtotal * 2; -- Fallback temporal (se arreglará en V2 con status)
            ELSE
                v_precio_final := v_subtotal / (1.0 - ((COALESCE(v_rule.ml_commission_percentage, 0) + v_margen_percent) / 100.0));
            END IF;
        ELSE
            -- Fixed markup (Ganancia fija)
            IF COALESCE(v_rule.ml_commission_percentage, 0) >= 100 THEN
                v_precio_final := v_subtotal + v_rule.value;
            ELSE
                v_precio_final := (v_subtotal + v_rule.value) / (1.0 - (COALESCE(v_rule.ml_commission_percentage, 0) / 100.0));
            END IF;
        END IF;

        -- c) Actualizar o Insertar el precio final en marketplace_prices
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
