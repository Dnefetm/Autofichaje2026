-- =============================================================================
-- v122: Precios pre-publicación orientados a PROVEEDOR + cálculo por artículo
-- =============================================================================
-- Propósito: desbloquear "Publicar en Meli" para cuentas LEGACY, permitiendo
-- calcular el precio de un artículo ANTES de que exista la publicación, usando
-- la MISMA fórmula del Motor V2 (fn_recalcular_precio_publicacion) pero
-- resolviendo la regla por (articulo_id → proveedor, marketplace_id, category_id).
--
-- NO toca las funciones existentes (fn_resolver_regla_pricing /
-- fn_recalcular_precio_publicacion): es aditivo.

-- 1. Añadir dimensión "proveedor" a pricing_rule_v3 (nullable = aplica a todos)
ALTER TABLE public.pricing_rule_v3
  ADD COLUMN IF NOT EXISTS proveedor TEXT;

COMMENT ON COLUMN public.pricing_rule_v3.proveedor IS
  'Proveedor del producto (ej. Urrea, Victorinox). NULL = aplica a todos los proveedores. Cada proveedor tiene su propio perfil de precios (con/sin rentabilidad incluida).';

-- 2. Resolver la regla de precio por artículo (sin depender de una publicación)
CREATE OR REPLACE FUNCTION public.fn_resolver_regla_prepublicacion(
  p_articulo_id   TEXT,
  p_marketplace_id UUID,
  p_category_id   TEXT
) RETURNS public.pricing_rule_v3
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_proveedor TEXT;
  v_marca     TEXT;
  v_costo     NUMERIC;
  v_rule      public.pricing_rule_v3;
BEGIN
  -- a) Proveedor del artículo: alias bloqueado primero, luego el más reciente
  SELECT pa.proveedor INTO v_proveedor
  FROM public.proveedor_articulos_alias pa
  WHERE pa.articulo_id = p_articulo_id
  ORDER BY pa.locked DESC, pa.ultima_vez_visto DESC NULLS LAST, pa.creado_el DESC
  LIMIT 1;

  -- b) Marca del artículo
  SELECT a.marca INTO v_marca
  FROM public.articulos a
  WHERE a.articulo_id = p_articulo_id;

  -- c) Costo de referencia (solo para evaluar rangos precio_min/precio_max)
  SELECT c.valor INTO v_costo
  FROM public.costos_articulo c
  WHERE c.articulo_id = p_articulo_id
    AND c.vigente = true
    AND lower(c.tipo_costo) = 'menudeo'
  ORDER BY c.creado_el DESC
  LIMIT 1;

  -- d) Regla más específica que cumpla TODOS los criterios definidos
  SELECT * INTO v_rule
  FROM public.pricing_rule_v3 r
  WHERE r.is_active = true
    AND (r.marketplace_id IS NULL OR r.marketplace_id = p_marketplace_id)
    AND (r.proveedor     IS NULL OR lower(r.proveedor) = lower(v_proveedor))
    AND (r.marca         IS NULL OR r.marca = '' OR v_marca ILIKE ANY (string_to_array(replace(r.marca, ', ', ','), ',')))
    AND (r.category_id   IS NULL OR r.category_id = '' OR p_category_id ILIKE ANY (string_to_array(replace(r.category_id, ', ', ','), ',')))
    AND (r.articulo_id   IS NULL OR r.articulo_id = '' OR r.articulo_id = p_articulo_id)
    AND (r.precio_min    IS NULL OR v_costo >= r.precio_min)
    AND (r.precio_max    IS NULL OR v_costo <= r.precio_max)
  ORDER BY
    (CASE WHEN r.articulo_id   IS NOT NULL AND r.articulo_id != '' THEN 1 ELSE 0 END
   + CASE WHEN r.proveedor     IS NOT NULL AND r.proveedor != '' THEN 1 ELSE 0 END
   + CASE WHEN r.category_id   IS NOT NULL AND r.category_id != '' THEN 1 ELSE 0 END
   + CASE WHEN r.marca         IS NOT NULL AND r.marca != '' THEN 1 ELSE 0 END
   + CASE WHEN r.marketplace_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.precio_min    IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.precio_max    IS NOT NULL THEN 1 ELSE 0 END) DESC,
    r.priority ASC
  LIMIT 1;

  RETURN v_rule;
END;
$function$;

-- 3. Calcular el precio pre-publicación con la MISMA fórmula del Motor V2
CREATE OR REPLACE FUNCTION public.fn_calcular_precio_prepublicacion(
  p_articulo_id    TEXT,
  p_marketplace_id UUID,
  p_category_id    TEXT
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
  -- Proveedor (para el detalle de auditoría)
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

  -- Costo base con el cost_basis de la regla (menudeo/mayoreo/distribuidor/...)
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

  -- Comisión + retenciones por categoría (misma fuente que el Motor V2)
  SELECT commission_effective, withholding_effective
    INTO v_commission_pct, v_withholding_pct
  FROM public.v_category_pricing_params
  WHERE category_id = p_category_id;

  IF v_commission_pct IS NULL THEN
    v_commission_pct  := 15.0;
    v_withholding_pct := 8.96;
  END IF;

  -- Fórmula idéntica a fn_recalcular_precio_publicacion
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

  -- Redondeo igual al Motor V2
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
    'envio_fijo', v_rule.envio_fijo
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_resolver_regla_prepublicacion(TEXT, UUID, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_calcular_precio_prepublicacion(TEXT, UUID, TEXT) TO anon, authenticated, service_role;
