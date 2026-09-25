-- =============================================================================
-- MIGRACIÓN (append-only): Corregir lectura de comisión por tipo de publicación
-- =============================================================================
-- Problema: fn_recalcular_precio_publicacion lee la comisión sin filtrar por
--           listing_type_id. La vista v_category_pricing_params devuelve una fila
--           por (categoría, tipo de publicación), y el SELECT tomaba una fila
--           arbitraria (en la práctica la de Premium), aplicando comisión de
--           Premium a artículos Clásica.
--
--           Verificado con datos reales: 5/5 artículos Clásica mostraban comisión
--           de Premium (18.00%/16.50% en vez de 13.50%).
--
-- Fix: filtrar por listing_type_id + ORDER BY + LIMIT 1 (determinista).
--
-- Basada en 20260918000001_fn_recalcular_precio_publicacion_canonico
-- (versión vigente: costo canónico vía fn_costo_articulo_vigente).
-- ÚNICO cambio: el filtro por listing_type_id en la consulta de comisión.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_recalcular_precio_publicacion(p_publicacion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $$
DECLARE
  v_pub RECORD; 
  v_rule pricing_rule_v3; 
  v_override RECORD;
  v_costo_base NUMERIC(12,2);
  v_commission_pct NUMERIC(5,2); 
  v_commission_src TEXT;
  v_withholding_pct NUMERIC(5,2); 
  v_withholding_src TEXT;
  
  -- Modificadores
  v_aplicar_margen BOOLEAN;
  v_margen_pct NUMERIC(5,2);
  v_aplicar_comision BOOLEAN;
  v_comision_pct_efectiva NUMERIC(5,2);
  v_aplicar_envio BOOLEAN;
  v_envio_monto NUMERIC(12,2);
  v_aplicar_retenciones BOOLEAN;
  v_retenciones_pct_efectiva NUMERIC(5,2);
  v_aplicar_redondeo BOOLEAN;
  v_redondeo_target_pct NUMERIC(5,2);
  v_redondeo_min_pct NUMERIC(5,2);
  v_redondeo_max_pct NUMERIC(5,2);
  v_redondeo_modo TEXT;
  
  -- Totales y Resultados
  v_denominador NUMERIC(8,4); 
  v_numerador NUMERIC(12,2);
  v_subtotal NUMERIC(12,2);
  v_precio_final NUMERIC(12,2);
  v_status TEXT := 'valid'; 
  v_reason TEXT := 'OK';
BEGIN
  SELECT * INTO v_pub FROM publicaciones_externas WHERE id = p_publicacion_id;
  IF v_pub IS NULL THEN RETURN; END IF;

  v_rule := fn_resolver_regla_pricing(p_publicacion_id);
  IF v_rule IS NULL THEN
    INSERT INTO publication_pricing_drafts (publicacion_id, draft_cost, draft_price, pricing_status, pricing_review_status, details, updated_at) 
    VALUES (p_publicacion_id, 0, 0, 'no_rule', 'pending', '{}'::jsonb, now())
    ON CONFLICT (publicacion_id) DO UPDATE SET pricing_status='no_rule', updated_at = now();
    RETURN;
  END IF;

  SELECT * INTO v_override
  FROM publication_pricing_overrides
  WHERE publicacion_id = p_publicacion_id
    AND (valido_hasta IS NULL OR valido_hasta > now());

  -- Costo base desde la capa canónica (precios_proveedor ⨝ alias), por artículo.
  SELECT SUM(public.fn_costo_articulo_vigente(m.articulo_id, v_rule.cost_basis) * m.cantidad_requerida)
    INTO v_costo_base
  FROM mapeo_publicacion_articulo m
  WHERE m.publicacion_id = p_publicacion_id;

  IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
    INSERT INTO publication_pricing_drafts (publicacion_id, draft_cost, draft_price, pricing_status, pricing_review_status, details, updated_at) 
    VALUES (p_publicacion_id, 0, 0, 'missing_cost', 'pending', '{}'::jsonb, now())
    ON CONFLICT (publicacion_id) DO UPDATE SET pricing_status='missing_cost', updated_at = now();
    RETURN;
  END IF;

  -- Comisiones del Marketplace (filtrando por tipo de publicación)
  SELECT commission_effective, commission_source
    INTO v_commission_pct, v_commission_src
  FROM v_category_pricing_params
  WHERE category_id = v_pub.category_id
    AND listing_type_id = v_pub.listing_type_id
  ORDER BY commission_source DESC NULLS LAST, commission_effective DESC
  LIMIT 1;

  IF v_commission_pct IS NULL THEN
    v_commission_pct := 15.0; 
    v_commission_src := 'fallback_global';
    v_status := 'estimated_params';
  END IF;

  -- Retenciones Fiscales Globales
  SELECT COALESCE((settings->>'withholding_tax_pct')::numeric, 9.0)
    INTO v_withholding_pct
  FROM marketplace_configs
  WHERE id = v_pub.marketplace_id;

  v_withholding_src := 'configuracion_global';

  -- Resolucion de Modificadores (Default de la Regla + Overrides individuales)
  v_aplicar_margen       := COALESCE((v_override.modifiers_override->>'aplicar_margen')::boolean, v_rule.aplicar_margen, true);
  v_margen_pct           := COALESCE((v_override.modifiers_override->>'margen_pct')::numeric, v_rule.margen_objetivo, 0.0);
  
  v_aplicar_comision     := COALESCE((v_override.modifiers_override->>'aplicar_comision')::boolean, v_rule.aplicar_comision, true);
  v_comision_pct_efectiva:= CASE WHEN v_aplicar_comision THEN v_commission_pct ELSE 0.0 END;
  
  v_aplicar_envio        := COALESCE((v_override.modifiers_override->>'aplicar_envio')::boolean, v_rule.aplicar_envio, true);
  v_envio_monto          := CASE WHEN v_aplicar_envio THEN (COALESCE(v_pub.shipping_cost_monto, 0) + COALESCE(v_rule.envio_fijo, 0)) ELSE 0.0 END;
  
  v_aplicar_retenciones  := COALESCE((v_override.modifiers_override->>'aplicar_retenciones')::boolean, v_rule.aplicar_retenciones, true);
  v_retenciones_pct_efectiva := CASE WHEN v_aplicar_retenciones THEN v_withholding_pct ELSE 0.0 END;
  
  v_aplicar_redondeo     := COALESCE((v_override.modifiers_override->>'aplicar_redondeo_magico')::boolean, v_rule.aplicar_redondeo_magico, true);
  v_redondeo_target_pct  := COALESCE((v_override.modifiers_override->>'redondeo_target_pct')::numeric, v_rule.redondeo_target_pct, -10.0);
  v_redondeo_min_pct     := COALESCE((v_override.modifiers_override->>'redondeo_min_pct')::numeric, v_rule.redondeo_min_pct, 9.0);
  v_redondeo_max_pct     := COALESCE((v_override.modifiers_override->>'redondeo_max_pct')::numeric, v_rule.redondeo_max_pct, 14.0);
  v_redondeo_modo        := COALESCE(v_rule.redondeo, 'magic');

  -- Overrides de precio fijo manual
  IF v_override IS NOT NULL AND v_override.override_type = 'fixed_price' THEN
    v_precio_final := v_override.value;
    v_subtotal     := v_override.value;
    v_reason       := 'override_fixed_price';
    v_status       := 'override_active';
  ELSIF v_override IS NOT NULL AND v_override.override_type = 'custom_margin' THEN
    v_margen_pct   := v_override.value;
    v_aplicar_margen := true;
    v_reason       := 'override_margin';
  END IF;

  IF v_status != 'override_active' THEN
    v_reason := 'Regla ' || v_rule.name;
    
    -- Calculo del Numerador y Denominador
    v_numerador   := (v_costo_base * (1.0 + (CASE WHEN v_aplicar_margen THEN v_margen_pct ELSE 0.0 END) / 100.0)) + v_envio_monto;
    v_denominador := 1.0 - (v_comision_pct_efectiva + v_retenciones_pct_efectiva) / 100.0;

    IF v_denominador <= 0 THEN
      INSERT INTO publication_pricing_drafts (publicacion_id, draft_cost, draft_price, pricing_status, pricing_review_status, details, updated_at) 
      VALUES (p_publicacion_id, v_costo_base, 0, 'invalid_strategy', 'pending', '{}'::jsonb, now())
      ON CONFLICT (publicacion_id) DO UPDATE SET pricing_status='invalid_strategy', updated_at = now();
      RETURN;
    END IF;

    v_subtotal := ROUND(v_numerador / v_denominador, 2);

    -- Aplicacion de Redondeo
    IF v_aplicar_redondeo AND v_redondeo_modo != 'none' THEN
      IF v_redondeo_modo = '99' THEN
        v_precio_final := FLOOR(v_subtotal / 10) * 10 + 9;
      ELSIF v_redondeo_modo = '00' THEN
        v_precio_final := ROUND(v_subtotal / 10) * 10;
      ELSIF v_redondeo_modo = '5' THEN
        v_precio_final := ROUND(v_subtotal / 5) * 5;
      ELSE
        v_precio_final := fn_apply_magic_rounding(v_subtotal, v_redondeo_target_pct, v_redondeo_min_pct, v_redondeo_max_pct);
      END IF;
    ELSE
      v_precio_final := v_subtotal;
    END IF;
  END IF;

  -- GUARDAR EN DRAFTS CON EL PAYLOAD COMPLETO Y TRANSPARENTE
  INSERT INTO publication_pricing_drafts (
    publicacion_id, draft_cost, draft_price, pricing_status, pricing_review_status, details, updated_at
  ) VALUES (
    p_publicacion_id, v_costo_base, v_precio_final, v_status, 'pending',
    jsonb_build_object(
      'costo_base', v_costo_base,
      'cost_basis', v_rule.cost_basis,
      'subtotal', v_subtotal,
      'precio_final', v_precio_final,
      'reason', v_reason,
      'rule_id', v_rule.id,
      'rule_name', v_rule.name,
      'override_aplicado', (v_override IS NOT NULL),
      'modifiers', jsonb_build_object(
        'aplicar_margen', v_aplicar_margen,
        'margen_pct', v_margen_pct,
        'margen_monto', ROUND(v_costo_base * (v_margen_pct / 100.0), 2),
        'aplicar_comision', v_aplicar_comision,
        'comision_pct', v_commission_pct,
        'comision_fee', ROUND(v_subtotal * (v_comision_pct_efectiva / 100.0), 2),
        'aplicar_envio', v_aplicar_envio,
        'shipping_cost_monto', COALESCE(v_pub.shipping_cost_monto, 0),
        'shipping_cost_final', v_envio_monto,
        'aplicar_retenciones', v_aplicar_retenciones,
        'retenciones_pct', v_withholding_pct,
        'withholding_fee', ROUND(v_subtotal * (v_retenciones_pct_efectiva / 100.0), 2),
        'aplicar_redondeo_magico', v_aplicar_redondeo,
        'redondeo_target_pct', v_redondeo_target_pct,
        'redondeo_range', jsonb_build_object('min', v_redondeo_min_pct, 'max', v_redondeo_max_pct),
        'subtotal_sin_redondeo', v_subtotal,
        'redondeo_ajuste', ROUND(v_precio_final - v_subtotal, 2),
        'precio_final', v_precio_final
      ),
      'formula_humana', '(($' || v_costo_base::TEXT || ' × ' || (1.0 + (CASE WHEN v_aplicar_margen THEN v_margen_pct ELSE 0 END) / 100.0)::TEXT || ') + $' || v_envio_monto::TEXT || ') / (1 - ' || ((v_comision_pct_efectiva + v_retenciones_pct_efectiva)/100.0)::TEXT || ') = $' || v_subtotal::TEXT || ' ➔ Final: $' || v_precio_final::TEXT
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

END $$;
