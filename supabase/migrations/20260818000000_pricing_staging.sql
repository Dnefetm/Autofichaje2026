-- =============================================================================
-- MIGRACIÓN: Flujo Staging para Precios y Bundles (Revisión Humana)
-- =============================================================================

-- 1. Crear Tabla de Staging 1:1
CREATE TABLE IF NOT EXISTS publication_pricing_drafts (
    publicacion_id UUID PRIMARY KEY REFERENCES publicaciones_externas(id) ON DELETE CASCADE,
    draft_cost NUMERIC(12,2) NOT NULL,
    draft_price NUMERIC(12,2) NOT NULL,
    pricing_status TEXT,
    pricing_review_status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Modificar Función de Recálculo para redirigir el output a Drafts
CREATE OR REPLACE FUNCTION public.fn_recalcular_precio_publicacion(p_publicacion_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $body
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
    SELECT * INTO v_pub FROM publicaciones_externas WHERE id = p_publicacion_id;
    IF NOT FOUND THEN RETURN; END IF;
    v_old_price := v_pub.sale_price_calculated;

    SELECT * INTO v_override FROM publication_pricing_overrides 
    WHERE publicacion_id = p_publicacion_id AND (valido_hasta IS NULL OR valido_hasta > now());

    IF FOUND AND v_override.override_type = 'fixed_price' THEN
        v_precio_final := v_override.value;
        v_status := 'override_active';
        v_reason := 'Precio fijo manual';
        
        INSERT INTO publication_pricing_drafts (
            publicacion_id, draft_cost, draft_price, pricing_status, pricing_review_status, details, updated_at
        ) VALUES (
            p_publicacion_id, 0, v_precio_final, v_status, 'pending', jsonb_build_object('reason', v_reason), now()
        )
        ON CONFLICT (publicacion_id) DO UPDATE 
        SET draft_cost = 0, draft_price = v_precio_final, pricing_status = v_status, pricing_review_status = 'pending', details = jsonb_build_object('reason', v_reason), updated_at = now();
        RETURN;
    END IF;

    -- SUM() de costos para bundles
    SELECT SUM(c.valor * m.cantidad_requerida) INTO v_costo_base
    FROM mapeo_publicacion_articulo m
    JOIN costos_articulo c ON c.articulo_id = m.articulo_id AND c.vigente = true AND c.valor > 0
    WHERE m.publicacion_id = p_publicacion_id;

    IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
        INSERT INTO publication_pricing_drafts (
            publicacion_id, draft_cost, draft_price, pricing_status, pricing_review_status, details, updated_at
        ) VALUES (
            p_publicacion_id, 0, 0, 'error_no_cost', 'pending', '{}'::jsonb, now()
        )
        ON CONFLICT (publicacion_id) DO UPDATE 
        SET draft_cost = 0, draft_price = 0, pricing_status = 'error_no_cost', pricing_review_status = 'pending', updated_at = now();
        RETURN;
    END IF;

    SELECT * INTO v_commission FROM meli_category_commissions 
    WHERE marketplace_id = v_pub.marketplace_id AND category_id = v_pub.category_id AND is_current = true;

    DECLARE
        v_com_pct NUMERIC(5,2) := COALESCE(v_commission.commission_percentage, 15.00);
        v_com_fee NUMERIC(10,2) := CASE WHEN v_costo_base < 299 THEN 25.00 ELSE 0 END;
    BEGIN
        SELECT * INTO v_rule FROM pricing_rules WHERE marketplace_id = v_pub.marketplace_id AND is_active = true LIMIT 1;
        
        IF FOUND AND v_override.override_type = 'custom_margin' THEN
            v_margen_percent := v_override.value;
            v_reason := 'Margen custom manual';
        ELSIF FOUND AND v_rule.rule_type = 'margin_percentage' THEN
            v_margen_percent := v_rule.value;
            v_reason := 'Regla global de margen aplicada';
        ELSE
            v_margen_percent := 20.00;
        END IF;

        DECLARE
            v_subtotal NUMERIC(12,2) := (v_costo_base * 1.16) + COALESCE(v_rule.shipping_cost, 0) + v_com_fee;
        BEGIN
            IF (v_com_pct + v_margen_percent) >= 100 THEN
                v_status := 'error_negative_margin';
                v_precio_final := v_subtotal * 1.5; 
                v_reason := 'Suma de margen y comisión supera 100%';
            ELSE
                v_precio_final := v_subtotal / (1.0 - ((v_com_pct + v_margen_percent) / 100.0));
            END IF;

            v_precio_final := ROUND(v_precio_final, 2);

            -- En lugar de afectar a producción, UPSERT en la tabla drafts
            INSERT INTO publication_pricing_drafts (
                publicacion_id,
                draft_cost,
                draft_price,
                pricing_status,
                pricing_review_status,
                details,
                updated_at
            ) VALUES (
                p_publicacion_id,
                v_costo_base,
                v_precio_final,
                v_status,
                'pending',
                jsonb_build_object(
                    'comision_pct', v_com_pct,
                    'comision_fee', v_com_fee,
                    'margen_pct', v_margen_percent,
                    'reason', v_reason
                ),
                now()
            )
            ON CONFLICT (publicacion_id) DO UPDATE 
            SET draft_cost = EXCLUDED.draft_cost,
                draft_price = EXCLUDED.draft_price,
                pricing_status = EXCLUDED.pricing_status,
                pricing_review_status = 'pending',
                details = EXCLUDED.details,
                updated_at = now();
                
            -- También dejamos un registro en historial (opcional, pero útil)
            INSERT INTO publication_pricing_history (publicacion_id, old_price, new_price, status, reason) 
            VALUES (p_publicacion_id, v_old_price, v_precio_final, v_status, v_reason || ' (DRAFT)');
        END;
    END;
END;
$body;

-- 3. Crear Función de Aprobación Masiva
CREATE OR REPLACE FUNCTION public.fn_aprobar_precios_draft(p_publicaciones UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $body
DECLARE
    v_id UUID;
    v_draft RECORD;
BEGIN
    FOR v_id IN SELECT unnest(p_publicaciones) LOOP
        -- Obtener el draft
        SELECT * INTO v_draft FROM publication_pricing_drafts WHERE publicacion_id = v_id AND pricing_review_status = 'pending';
        
        IF FOUND THEN
            -- Actualizar producción
            UPDATE publicaciones_externas 
            SET sale_price_calculated = v_draft.draft_price,
                precio_venta = v_draft.draft_price,
                base_price = v_draft.draft_price,
                pricing_status = v_draft.pricing_status,
                last_calc_at = now(),
                actualizado_el = now()
            WHERE id = v_id;
            
            -- Marcar como aprobado
            UPDATE publication_pricing_drafts SET pricing_review_status = 'approved', updated_at = now() WHERE publicacion_id = v_id;
            
            -- Encolar el sync
            INSERT INTO jobs (type, payload, status) 
            VALUES ('sync_price', jsonb_build_object('publicacion_id', v_id), 'pending');
        END IF;
    END LOOP;
END;
$body;
