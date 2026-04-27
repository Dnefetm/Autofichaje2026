-- =============================================================================
-- MIGRACIÓN v80: Motor de Precios para Mercado Libre (Recálculo Matemático)
-- =============================================================================

-- 1. Crear pricing_rules si no existe
CREATE TABLE IF NOT EXISTS pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace_id UUID REFERENCES marketplace_configs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL,
    value NUMERIC(10,2) NOT NULL,
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ampliar pricing_rules para soportar parámetros de la fórmula ML
ALTER TABLE pricing_rules 
ADD COLUMN IF NOT EXISTS tax_percentage NUMERIC(5,2) DEFAULT 16.00, -- IVA
ADD COLUMN IF NOT EXISTS ml_commission_percentage NUMERIC(5,2) DEFAULT 15.00, -- Comisión por categoría
ADD COLUMN IF NOT EXISTS ml_fixed_fee NUMERIC(10,2) DEFAULT 25.00, -- Cargo fijo para productos < $299
ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(10,2) DEFAULT 0.00; -- Costo de envío estimado

-- 2. Función Principal de Recálculo
CREATE OR REPLACE FUNCTION fn_recalcular_precio_marketplace(p_articulo_id TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_costo_base NUMERIC(12,2);
    v_rule RECORD;
    v_costo_bruto NUMERIC(12,2);
    v_subtotal NUMERIC(12,2);
    v_precio_final NUMERIC(12,2);
    v_margen_percent NUMERIC(5,2);
    v_marketplace_id UUID;
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

    -- b) Iterar por los marketplaces (reglas activas) para este artículo
    -- Por simplicidad, tomamos la regla de mayor prioridad por cada marketplace
    FOR v_rule IN (
        SELECT r.* 
        FROM pricing_rules r
        WHERE r.is_active = true
    ) LOOP
        -- Fórmula: 
        -- Costo Bruto = Costo Base * (1 + (tax_percentage / 100))
        v_costo_bruto := v_costo_base * (1 + (COALESCE(v_rule.tax_percentage, 0) / 100.0));
        
        -- Subtotal = Costo Bruto + Envío + Cargo Fijo
        v_subtotal := v_costo_bruto + COALESCE(v_rule.shipping_cost, 0) + COALESCE(v_rule.ml_fixed_fee, 0);

        -- Extraer Margen
        IF v_rule.rule_type = 'margin_percentage' THEN
            v_margen_percent := v_rule.value;
            
            -- Evitar división por cero o negativa
            IF (v_rule.ml_commission_percentage + v_margen_percent) >= 100 THEN
                v_precio_final := v_subtotal * 2; -- Fallback de seguridad si la suma es >= 100%
            ELSE
                -- Precio Venta = Subtotal / (1 - (Comision_ML% + Margen%))
                v_precio_final := v_subtotal / (1.0 - ((COALESCE(v_rule.ml_commission_percentage, 0) + v_margen_percent) / 100.0));
            END IF;
        ELSE
            -- Fixed markup (Ganancia fija)
            -- Precio Venta = (Subtotal + Ganancia Fija) / (1 - Comision_ML%)
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

-- 3. Trigger en costos_articulo para auto-recalcular
CREATE OR REPLACE FUNCTION trg_costos_articulo_recalcular()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.articulo_id IS NOT NULL AND NEW.vigente = true THEN
        PERFORM fn_recalcular_precio_marketplace(NEW.articulo_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_recalcular_precios ON costos_articulo;
CREATE TRIGGER trigger_recalcular_precios
    AFTER INSERT OR UPDATE OF valor, vigente, articulo_id
    ON costos_articulo
    FOR EACH ROW
    EXECUTE FUNCTION trg_costos_articulo_recalcular();
