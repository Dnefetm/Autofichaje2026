-- =============================================================================
-- FASE 1: Estructuras V2 para Motor de Precios Vidriera-Céntrico
-- =============================================================================

-- 1. Añadir columnas a publicaciones_externas (sin destruir tabla previa aún)
ALTER TABLE publicaciones_externas
ADD COLUMN IF NOT EXISTS sale_price_calculated NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS pricing_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS last_calc_at TIMESTAMPTZ;

-- 2. Tabla de Comisiones Dinámicas por Categoría (SCD2)
CREATE TABLE IF NOT EXISTS meli_category_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace_id UUID REFERENCES marketplace_configs(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL,
    commission_percentage NUMERIC(5,2) NOT NULL,
    fixed_fee_threshold NUMERIC(10,2) DEFAULT 299.00,
    vigente_desde TIMESTAMPTZ DEFAULT now(),
    vigente_hasta TIMESTAMPTZ,
    is_current BOOLEAN DEFAULT true,
    UNIQUE(marketplace_id, category_id, is_current)
);

-- 3. Tabla de Excepciones Manuales (Overrides)
CREATE TABLE IF NOT EXISTS publication_pricing_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publicacion_id UUID REFERENCES publicaciones_externas(id) ON DELETE CASCADE,
    override_type TEXT NOT NULL CHECK (override_type IN ('fixed_price', 'custom_margin')),
    value NUMERIC(12,2) NOT NULL,
    valido_hasta TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(publicacion_id)
);

-- 4. Historial de Auditoría
CREATE TABLE IF NOT EXISTS publication_pricing_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publicacion_id UUID REFERENCES publicaciones_externas(id) ON DELETE CASCADE,
    old_price NUMERIC(12,2),
    new_price NUMERIC(12,2),
    status TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Función Matemática Central (V2)
CREATE OR REPLACE FUNCTION fn_recalcular_precio_publicacion(p_publicacion_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_pub RECORD;
    v_costo_base NUMERIC(12,2);
    v_override RECORD;
    v_commission RECORD;
    v_rule RECORD;
    v_precio_final NUMERIC(12,2);
    v_old_price NUMERIC(12,2);
    v_status TEXT := 'valid';
    v_reason TEXT := 'Cálculo exitoso';
    v_margen_percent NUMERIC(5,2);
BEGIN
    -- a) Obtener datos de la publicación
    SELECT * INTO v_pub 
    FROM publicaciones_externas 
    WHERE id = p_publicacion_id;

    IF NOT FOUND THEN RETURN; END IF;
    v_old_price := v_pub.sale_price_calculated;

    -- b) Revisar Overrides
    SELECT * INTO v_override 
    FROM publication_pricing_overrides 
    WHERE publicacion_id = p_publicacion_id AND (valido_hasta IS NULL OR valido_hasta > now());

    IF FOUND AND v_override.override_type = 'fixed_price' THEN
        -- Excepción Pura: El usuario dictó un precio fijo. Se ignora la matemática.
        UPDATE publicaciones_externas 
        SET sale_price_calculated = v_override.value, pricing_status = 'override_active', last_calc_at = now()
        WHERE id = p_publicacion_id;
        
        INSERT INTO publication_pricing_history (publicacion_id, old_price, new_price, status, reason)
        VALUES (p_publicacion_id, v_old_price, v_override.value, 'override_active', 'Precio fijo manual');
        RETURN;
    END IF;

    -- c) Sumar Costo Base del Bundle
    SELECT SUM(c.valor * m.cantidad_requerida) INTO v_costo_base
    FROM mapeo_publicacion_articulo m
    JOIN costos_articulo c ON c.articulo_id = m.sku_articulo AND c.vigente = true AND c.valor > 0
    -- Tomamos solo el costo menudeo o el mayor para simplificar por ahora
    WHERE m.publicacion_id = p_publicacion_id;

    IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
        UPDATE publicaciones_externas 
        SET pricing_status = 'error_no_cost', last_calc_at = now() WHERE id = p_publicacion_id;
        RETURN;
    END IF;

    -- d) Obtener Comisión de Meli por Categoría
    SELECT * INTO v_commission 
    FROM meli_category_commissions 
    WHERE marketplace_id = v_pub.marketplace_id AND category_id = v_pub.category_id AND is_current = true;

    -- Si no hay comisión específica, usamos un fallback seguro (ej. 15%)
    DECLARE
        v_com_pct NUMERIC(5,2) := COALESCE(v_commission.commission_percentage, 15.00);
        v_com_fee NUMERIC(10,2) := CASE WHEN v_costo_base < 299 THEN 25.00 ELSE 0 END;
    BEGIN
        -- e) Obtener Estrategia Global (Margen)
        SELECT * INTO v_rule FROM pricing_rules WHERE marketplace_id = v_pub.marketplace_id AND is_active = true LIMIT 1;
        
        -- Si hay override de margen, úsalo; si no, el de la regla global
        IF FOUND AND v_override.override_type = 'custom_margin' THEN
            v_margen_percent := v_override.value;
            v_reason := 'Margen custom manual';
        ELSIF v_rule.rule_type = 'margin_percentage' THEN
            v_margen_percent := v_rule.value;
            v_reason := 'Regla global de margen aplicada';
        ELSE
            v_margen_percent := 20.00; -- Fallback final
        END IF;

        -- f) Matemática Final
        -- Subtotal = CostoBase * IVA + Envio + Fee Fijo
        DECLARE
            v_subtotal NUMERIC(12,2) := (v_costo_base * 1.16) + COALESCE(v_rule.shipping_cost, 0) + v_com_fee;
        BEGIN
            IF (v_com_pct + v_margen_percent) >= 100 THEN
                v_status := 'error_negative_margin';
                v_precio_final := v_subtotal * 1.5; -- Protección anti-quiebra, pero el status alerta al usuario
                v_reason := 'Suma de margen y comisión supera 100%';
            ELSE
                v_precio_final := v_subtotal / (1.0 - ((v_com_pct + v_margen_percent) / 100.0));
            END IF;

            v_precio_final := ROUND(v_precio_final, 2);

            -- g) Guardar Resultado
            UPDATE publicaciones_externas 
            SET sale_price_calculated = v_precio_final, pricing_status = v_status, last_calc_at = now()
            WHERE id = p_publicacion_id;

            INSERT INTO publication_pricing_history (publicacion_id, old_price, new_price, status, reason)
            VALUES (p_publicacion_id, v_old_price, v_precio_final, v_status, v_reason);
        END;
    END;
END;
$$;
