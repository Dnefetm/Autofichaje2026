-- Fix: Use creado_el instead of actualizado_el
BEGIN;

CREATE OR REPLACE FUNCTION fn_resolver_regla_pricing(p_publicacion_id UUID)
RETURNS pricing_rule_v3 LANGUAGE plpgsql AS $$
DECLARE v_pub RECORD; v_costo NUMERIC; v_rule pricing_rule_v3; v_marca TEXT;
BEGIN
  -- 1) Datos de la publicación + marca y articulo principal
  SELECT pe.id, pe.marketplace_id, pe.category_id,
         (SELECT m.articulo_id FROM mapeo_publicacion_articulo m
            WHERE m.publicacion_id = pe.id LIMIT 1) AS articulo_id,
         (SELECT a.marca FROM articulos a
            WHERE a.articulo_id = (SELECT m.articulo_id FROM mapeo_publicacion_articulo m
                                   WHERE m.publicacion_id = pe.id LIMIT 1)) AS marca
    INTO v_pub
  FROM publicaciones_externas pe
  WHERE pe.id = p_publicacion_id;

  -- 2) Costo base de referencia (para evaluar criterios de rango)
  SELECT c.valor INTO v_costo
  FROM costos_articulo c
  WHERE c.articulo_id = v_pub.articulo_id
    AND c.vigente = true
    AND lower(c.tipo_costo) = 'menudeo'
  ORDER BY c.creado_el DESC LIMIT 1;

  -- 3) Selección por especificidad: la regla más específica que cumpla TODOS los criterios definidos
  SELECT * INTO v_rule
  FROM pricing_rule_v3 r
  WHERE r.is_active = true
    AND (r.marketplace_id IS NULL OR r.marketplace_id = v_pub.marketplace_id)
    AND (r.marca         IS NULL OR r.marca         = v_pub.marca)
    AND (r.category_id   IS NULL OR r.category_id   = v_pub.category_id)
    AND (r.articulo_id   IS NULL OR r.articulo_id   = v_pub.articulo_id)
    AND (r.precio_min    IS NULL OR v_costo >= r.precio_min)
    AND (r.precio_max    IS NULL OR v_costo <= r.precio_max)
  ORDER BY
    (CASE WHEN r.articulo_id   IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.category_id   IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.marca         IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.marketplace_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.precio_min    IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.precio_max    IS NOT NULL THEN 1 ELSE 0 END) DESC,
    r.priority ASC
  LIMIT 1;

  RETURN v_rule;
END $$;

CREATE OR REPLACE FUNCTION fn_recalcular_precio_publicacion(p_publicacion_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_pub RECORD; v_rule pricing_rule_v3; v_override RECORD;
  v_costo_base NUMERIC(12,2);
  v_commission_pct NUMERIC(5,2); v_commission_src TEXT;
  v_withholding_pct NUMERIC(5,2); v_withholding_src TEXT;
  v_denominador NUMERIC(8,4); v_numerador NUMERIC(12,2);
  v_precio_final NUMERIC(12,2);
  v_status TEXT := 'valid'; v_reason TEXT := 'OK';
BEGIN
  SELECT * INTO v_pub FROM publicaciones_externas WHERE id = p_publicacion_id;
  IF v_pub IS NULL THEN RETURN; END IF;

  v_rule := fn_resolver_regla_pricing(p_publicacion_id);
  IF v_rule IS NULL THEN
    UPDATE publicaciones_externas SET pricing_status='no_rule', last_calc_at=now() WHERE id=p_publicacion_id;
    RETURN;
  END IF;

  SELECT * INTO v_override
  FROM publication_pricing_overrides
  WHERE publicacion_id = p_publicacion_id
    AND (valido_hasta IS NULL OR valido_hasta > now());

  WITH costo_unico AS (
    SELECT DISTINCT ON (c.articulo_id) c.articulo_id, c.valor
    FROM costos_articulo c
    WHERE c.vigente = true AND c.valor > 0
      AND lower(c.tipo_costo) = lower(v_rule.cost_basis)
    ORDER BY c.articulo_id, c.creado_el DESC
  )
  SELECT SUM(cu.valor * m.cantidad_requerida) INTO v_costo_base
  FROM mapeo_publicacion_articulo m
  JOIN costo_unico cu ON cu.articulo_id = m.articulo_id
  WHERE m.publicacion_id = p_publicacion_id;

  IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
    UPDATE publicaciones_externas
       SET pricing_status='missing_cost', last_calc_at=now()
     WHERE id=p_publicacion_id;
    RETURN;
  END IF;

  SELECT commission_effective, commission_source,
         withholding_effective, withholding_source
    INTO v_commission_pct, v_commission_src,
         v_withholding_pct, v_withholding_src
  FROM v_category_pricing_params
  WHERE category_id = v_pub.category_id;

  IF v_commission_pct IS NULL THEN
    v_commission_pct  := 16.0; v_commission_src := 'fallback_global';
    v_withholding_pct := 8.0;  v_withholding_src:= 'fallback_global';
    v_status := 'estimated_params';
  END IF;

  IF v_override IS NOT NULL THEN
    IF v_override.override_type = 'fixed_price' THEN
      v_precio_final := v_override.value;
      v_reason := 'override_fixed_price';
      v_status := 'override';
    ELSIF v_override.override_type = 'custom_margin' THEN
      v_rule.margen_objetivo := v_override.value;
      v_reason := 'override_margin';
    END IF;
  END IF;

  IF v_status != 'override' THEN
    v_numerador := v_costo_base * (1 + v_rule.margen_objetivo / 100.0)
                 + COALESCE(v_rule.envio_fijo, 0);
    v_denominador := 1.0 - (v_commission_pct + v_withholding_pct) / 100.0;

    IF v_denominador <= 0 THEN
      UPDATE publicaciones_externas
         SET pricing_status='invalid_strategy',
             last_calc_at=now()
       WHERE id=p_publicacion_id;
      RETURN;
    END IF;

    v_precio_final := v_numerador / v_denominador;

    v_precio_final := CASE v_rule.redondeo
      WHEN '99' THEN FLOOR(v_precio_final / 10) * 10 + 9
      WHEN '00' THEN ROUND(v_precio_final / 10) * 10
      WHEN '5'  THEN ROUND(v_precio_final / 5)  * 5
      ELSE ROUND(v_precio_final, 2)
    END;
  END IF;

  -- persist

  UPDATE publicaciones_externas
     SET sale_price_calculated = v_precio_final,
         pricing_status = v_status,
         last_calc_at = now()
   WHERE id = p_publicacion_id;

  INSERT INTO publication_pricing_history(
    publicacion_id, precio_anterior, precio_nuevo, razon, detalle, created_at)
  VALUES (
    p_publicacion_id, v_pub.sale_price_calculated, v_precio_final, v_reason,
    jsonb_build_object(
      'costo_base', v_costo_base,
      'cost_basis', v_rule.cost_basis,
      'margen_pct', v_rule.margen_objetivo,
      'comision_pct', v_commission_pct, 'comision_src', v_commission_src,
      'retenciones_pct', v_withholding_pct, 'retenciones_src', v_withholding_src,
      'envio_fijo', v_rule.envio_fijo,
      'rule_id', v_rule.id, 'rule_name', v_rule.name,
      'override_aplicado', (v_override IS NOT NULL)
    ), now());
END $$;

COMMIT;
