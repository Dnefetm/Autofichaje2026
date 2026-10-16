-- =============================================================================
-- MIGRACIÓN (append-only): Capa canónica de costo de artículo (Mundo 1 + Mundo 2)
-- =============================================================================
-- Problema: el publicador Meli (fn_calcular_precio_prepublicacion) leía el costo
--           de `costos_articulo` (tabla legacy que el flujo nuevo ya NO puebla).
--           El flujo nuevo escribe precios en `precios_proveedor` (Mundo 1) y el
--           vínculo proveedor→catálogo en `proveedor_articulos_alias` (Mundo 2),
--           por lo que `costos_articulo` quedaba vacío → "Sin costo vigente".
--
-- Solución: una ÚNICA función canónica `fn_costo_articulo_vigente` que resuelve
--           el costo desde `precios_proveedor ⨝ proveedor_articulos_alias`, y
--           apuntar a ella el cálculo de precio pre-publicación (y su regla).
--           NO se toca `costos_articulo`: se deja de usar como fuente de costo.
--
-- Idempotente (CREATE OR REPLACE). No borra ni altera tablas existentes.
-- Dependencias: precios_proveedor (00020), proveedor_articulos_alias (v98),
--               fn_resolver_regla_prepublicacion / fn_calcular_precio_prepublicacion
--               (v122/v123) — esta migración las REEMPLAZA.
-- =============================================================================
BEGIN;

-- 1. Índice para resolver por artículo (la capa canónica consulta por articulo_id)
CREATE INDEX IF NOT EXISTS ix_paa_articulo_id
  ON public.proveedor_articulos_alias (articulo_id);

-- 2. Normalización de tipo_costo: "Menudeo sin IVA", "MENUDEO", "menudeo con iva"
--    → "menudeo". El tier del proveedor es texto libre; la regla usa el término
--    canónico (menudeo / distribuidor / mayoreo / subdistribuidor).
CREATE OR REPLACE FUNCTION public.fn_normalizar_tipo_costo(p_tipo_costo TEXT)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(
    regexp_replace(
      COALESCE(p_tipo_costo, ''),
      '(sin|con)\s+iv[áa](\s+incluido)?',
      '',
      'i'
    )
  ));
$$;

-- 3. Costo vigente de un artículo para un tier dado.
--    Prioridad: alias bloqueado (locked) primero, luego el más reciente;
--    dentro del mismo artículo, el precio más reciente.
CREATE OR REPLACE FUNCTION public.fn_costo_articulo_vigente(
  p_articulo_id TEXT,
  p_tipo_costo  TEXT
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pp.valor
  FROM public.proveedor_articulos_alias pa
  JOIN public.precios_proveedor pp
    ON pp.proveedor = pa.proveedor
   AND pp.sku_proveedor = btrim(pa.modelo_excel)
  WHERE pa.articulo_id = p_articulo_id
    AND pa.modelo_excel IS NOT NULL
    AND btrim(pa.modelo_excel) <> ''
    AND pp.vigente = true
    AND pp.valor > 0
    AND public.fn_normalizar_tipo_costo(pp.tipo_costo)
        = public.fn_normalizar_tipo_costo(p_tipo_costo)
  ORDER BY pa.locked DESC,
           pa.ultima_vez_visto DESC NULLS LAST,
           pa.creado_el DESC,
           pp.creado_el DESC
  LIMIT 1;
$$;

-- 4. fn_resolver_regla_prepublicacion: costo de referencia ahora desde la capa canónica.
--    (Reemplaza la lectura de costos_articulo que evaluaba precio_min/precio_max.)
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
  v_costo := public.fn_costo_articulo_vigente(p_articulo_id, 'menudeo');

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

-- 5. fn_calcular_precio_prepublicacion: costo base ahora desde la capa canónica.
--    (Reemplaza la lectura directa de costos_articulo.)
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

  -- Costo base con el cost_basis de la regla (menudeo/mayoreo/distribuidor/...)
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

-- 6. Permisos
GRANT EXECUTE ON FUNCTION public.fn_normalizar_tipo_costo(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_costo_articulo_vigente(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolver_regla_prepublicacion(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_calcular_precio_prepublicacion(TEXT, UUID, TEXT, TEXT) TO authenticated, service_role;

COMMIT;

-- =============================================================================
-- ROLLBACK (solo si se desea revertir esta migración)
-- =============================================================================
/*
BEGIN;
-- Re-aplicar fn_resolver_regla_prepublicacion de v122 y
-- fn_calcular_precio_prepublicacion de v123 (versiones que leían costos_articulo).
DROP FUNCTION IF EXISTS public.fn_costo_articulo_vigente(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.fn_normalizar_tipo_costo(TEXT);
DROP INDEX IF EXISTS public.ix_paa_articulo_id;
COMMIT;
*/
