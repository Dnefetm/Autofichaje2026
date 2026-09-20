-- =============================================================================
-- v128: Respetar los switches de la regla en el precio pre-publicación
-- =============================================================================
-- Problema: fn_calcular_precio_prepublicacion IGNORABA aplicar_margen,
-- aplicar_comision, aplicar_envio y aplicar_retenciones. Siempre aplicaba
-- comisión + retenciones. Para "Precios Urrea" (aplicar_retenciones = false)
-- inflaba el precio ~8.96% de más: 628 → 825.88 en vez de 738.82.
--
-- Fix: replicar la lógica de flags que YA usa el Motor V2
-- (fn_recalcular_precio_publicacion). Solo cambia el comportamiento de las
-- reglas que explícitamente apagaron un fee; las que tienen el flag NULL o
-- TRUE se comportan exactamente igual que antes (COALESCE(..., true)).
--
-- Alcance: SOLO reemplaza fn_calcular_precio_prepublicacion. No toca el Motor
-- V2, ni fn_resolver_regla_prepublicacion, ni fn_costo_articulo_vigente, ni
-- ninguna tabla. Es aditivo e idempotente (CREATE OR REPLACE).
-- =============================================================================
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
  v_rule                public.pricing_rule_v3;
  v_proveedor           TEXT;
  v_costo_base          NUMERIC(12,2);
  v_commission_pct      NUMERIC(5,2);
  v_withholding_pct     NUMERIC(5,2);
  v_comision_efectiva   NUMERIC(5,2);
  v_retenciones_efectiva NUMERIC(5,2);
  v_numerador           NUMERIC(12,2);
  v_denominador         NUMERIC(8,4);
  v_precio_final        NUMERIC(12,2);
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

  v_costo_base := public.fn_costo_articulo_vigente(p_articulo_id, v_rule.cost_basis);
  IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
    RETURN jsonb_build_object(
      'status', 'missing_cost',
      'sale_price', NULL,
      'proveedor', v_proveedor,
      'cost_basis', v_rule.cost_basis,
      'reason', 'Sin costo vigente (' || v_rule.cost_basis || ') para este artículo'
    );
  END IF;

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

  -- Respetar los switches de la regla (misma lógica que el Motor V2).
  -- COALESCE(..., true): si el flag está NULL, se aplica (comportamiento previo).
  v_comision_efectiva    := CASE WHEN COALESCE(v_rule.aplicar_comision, true)    THEN v_commission_pct  ELSE 0.0 END;
  v_retenciones_efectiva := CASE WHEN COALESCE(v_rule.aplicar_retenciones, true) THEN v_withholding_pct ELSE 0.0 END;

  v_numerador := v_costo_base
                 * (1.0 + (CASE WHEN COALESCE(v_rule.aplicar_margen, true) THEN v_rule.margen_objetivo ELSE 0.0 END) / 100.0)
                 + (CASE WHEN COALESCE(v_rule.aplicar_envio, true) THEN COALESCE(v_rule.envio_fijo, 0) ELSE 0.0 END);
  v_denominador := 1.0 - (v_comision_efectiva + v_retenciones_efectiva) / 100.0;

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
    'comision_pct', v_comision_efectiva,
    'retenciones_pct', v_retenciones_efectiva,
    'envio_fijo', v_rule.envio_fijo,
    'listing_type_id', p_listing_type_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_calcular_precio_prepublicacion(TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;
