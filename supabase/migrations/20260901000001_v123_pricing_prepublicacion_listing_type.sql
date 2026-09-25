-- =============================================================================
-- v123: Precio pre-publicación — filtrar comisión por listing_type_id
-- =============================================================================
-- Corrige el no-determinismo de v122: v_category_pricing_params tiene una fila
-- por (category_id, listing_type_id) con comisiones reales distintas
-- (ej. gold_special 15% vs gold_pro 19.5%). La función debe discriminar por el
-- listing_type_id que se va a publicar, no colapsar la vista.
--
-- Cambios vs v122:
--   1) DROP de la firma de 3 args (evita el overload huérfano).
--   2) Nueva firma de 4 args con p_listing_type_id.
--   3) Filtro AND listing_type_id = p_listing_type_id + ORDER BY + LIMIT 1.
--   4) 'reason' reintroducido en todos los returns tempranos.

DROP FUNCTION IF EXISTS public.fn_calcular_precio_prepublicacion(TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.fn_calcular_precio_prepublicacion(
  p_articulo_id     TEXT,
  p_marketplace_id  UUID,
  p_category_id     TEXT,
  p_listing_type_id TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rule            public.pricing_rule_v3;
  v_proveedor       TEXT;
  v_costo_base      NUMERIC(12,2);
  v_commission_pct  NUMERIC(5,2);
  v_withholding_pct NUMERIC(5,2);
  v_numerador       NUMERIC(12,2);
  v_denominador     NUMERIC(8,4);
  v_precio_final    NUMERIC(12,2);
BEGIN
  SELECT pa.proveedor INTO v_proveedor
  FROM public.proveedor_articulos_alias pa
  WHERE pa.articulo_id = p_articulo_id
  ORDER BY pa.locked DESC, pa.ultima_vez_visto DESC NULLS LAST, pa.creado_el DESC
  LIMIT 1;

  v_rule := public.fn_resolver_regla_prepublicacion(p_articulo_id, p_marketplace_id, p_category_id);
  IF v_rule IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'no_rule',
      'sale_price', NULL,
      'proveedor', v_proveedor,
      'reason', 'Sin regla de precio para este artículo/tienda/categoría'
    );
  END IF;

  SELECT c.valor INTO v_costo_base
  FROM public.costos_articulo c
  WHERE c.articulo_id = p_articulo_id
    AND c.vigente = true
    AND c.valor > 0
    AND lower(c.tipo_costo) = lower(v_rule.cost_basis)
  ORDER BY c.creado_el DESC
  LIMIT 1;

  IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'missing_cost',
      'sale_price', NULL,
      'proveedor', v_proveedor,
      'cost_basis', v_rule.cost_basis,
      'reason', 'Sin costo vigente (' || v_rule.cost_basis || ') para este artículo'
    );
  END IF;

  -- Comisión real por categoría + tipo de publicación (listing_type_id)
  SELECT commission_effective, withholding_effective
    INTO v_commission_pct, v_withholding_pct
  FROM public.v_category_pricing_params
  WHERE category_id = p_category_id
    AND listing_type_id = p_listing_type_id
  ORDER BY
    commission_source  DESC NULLS LAST,
    withholding_source DESC NULLS LAST,
    commission_effective DESC,
    withholding_effective DESC
  LIMIT 1;

  IF v_commission_pct IS NULL THEN
    v_commission_pct  := 15.0;
    v_withholding_pct := 8.96;
  END IF;

  v_numerador   := v_costo_base * (1 + v_rule.margen_objetivo / 100.0)
                 + COALESCE(v_rule.envio_fijo, 0);
  v_denominador := 1.0 - (v_commission_pct + v_withholding_pct) / 100.0;

  IF v_denominador <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'invalid_strategy',
      'sale_price', NULL,
      'proveedor', v_proveedor,
      'reason', 'Comisión + retenciones >= 100%'
    );
  END IF;

  v_precio_final := v_numerador / v_denominador;

  v_precio_final := CASE v_rule.redondeo
    WHEN '99' THEN FLOOR(v_precio_final / 10) * 10 + 9
    WHEN '00' THEN ROUND(v_precio_final / 10) * 10
    WHEN '5'  THEN ROUND(v_precio_final / 5)  * 5
    ELSE ROUND(v_precio_final, 2)
  END;

  RETURN jsonb_build_object(
    'status', 'valid',
    'sale_price', v_precio_final,
    'base_price', v_costo_base,
    'currency', 'MXN',
    'proveedor', v_proveedor,
    'rule_id', v_rule.id,
    'rule_name', v_rule.name,
    'cost_basis', v_rule.cost_basis,
    'margen_pct', v_rule.margen_objetivo,
    'comision_pct', v_commission_pct,
    'retenciones_pct', v_withholding_pct,
    'envio_fijo', v_rule.envio_fijo,
    'listing_type_id', p_listing_type_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_calcular_precio_prepublicacion(TEXT, UUID, TEXT, TEXT) TO anon, authenticated, service_role;
