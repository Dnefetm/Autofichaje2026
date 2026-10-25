-- 20261024: Unifica la resolución de regla de precio en una sola función canónica.
-- Antes: fn_resolver_regla_pricing (borrador) y fn_resolver_regla_prepublicacion (preview)
-- tenían lógica duplicada y divergente (proveedor, categoría, fuente de costo).
-- Ahora ambos son wrappers de fn_resolver_regla_canonico.
-- Fuente de costo: fn_costo_articulo_vigente (canónica), no costos_articulo (legacy).

-- 1) Función canónica (lógica correcta, basada en la del preview que respeta proveedor)
CREATE OR REPLACE FUNCTION public.fn_resolver_regla_canonico(
  p_articulo_id    TEXT,
  p_marketplace_id UUID,
  p_category_id    TEXT
) RETURNS pricing_rule_v3
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
  -- Proveedor del artículo: alias bloqueado primero, luego el más reciente
  SELECT pa.proveedor INTO v_proveedor
  FROM public.proveedor_articulos_alias pa
  WHERE pa.articulo_id = p_articulo_id
  ORDER BY pa.locked DESC, pa.ultima_vez_visto DESC NULLS LAST, pa.creado_el DESC
  LIMIT 1;

  -- Marca del artículo (fallback al alias bloqueado)
  SELECT a.marca INTO v_marca
  FROM public.articulos a
  WHERE a.articulo_id = p_articulo_id;
  IF v_marca IS NULL OR v_marca = '' THEN
    SELECT pa.marca_excel INTO v_marca
    FROM public.proveedor_articulos_alias pa
    WHERE pa.articulo_id = p_articulo_id AND pa.locked = true
    ORDER BY pa.creado_el DESC
    LIMIT 1;
  END IF;

  -- Costo de referencia (solo para rangos precio_min/precio_max) — fuente canónica
  v_costo := public.fn_costo_articulo_vigente(p_articulo_id, 'menudeo');

  -- Regla más específica que cumpla TODOS los criterios definidos
  SELECT * INTO v_rule
  FROM public.pricing_rule_v3 r
  WHERE r.is_active = true
    AND (r.marketplace_id IS NULL OR r.marketplace_id = p_marketplace_id)
    AND (r.proveedor     IS NULL OR lower(r.proveedor) = lower(COALESCE(v_proveedor, '')))
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

-- 2) Wrapper del preview (misma firma original)
CREATE OR REPLACE FUNCTION public.fn_resolver_regla_prepublicacion(
  p_articulo_id    TEXT,
  p_marketplace_id UUID,
  p_category_id    TEXT
) RETURNS pricing_rule_v3
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN public.fn_resolver_regla_canonico(p_articulo_id, p_marketplace_id, p_category_id);
END;
$function$;

-- 3) Wrapper del borrador (resuelve el artículo de la publicación y delega)
CREATE OR REPLACE FUNCTION public.fn_resolver_regla_pricing(p_publicacion_id UUID)
RETURNS pricing_rule_v3
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_articulo_id    TEXT;
  v_marketplace_id UUID;
  v_category_id    TEXT;
BEGIN
  SELECT pe.marketplace_id, pe.category_id,
         (SELECT m.articulo_id FROM public.mapeo_publicacion_articulo m WHERE m.publicacion_id = pe.id LIMIT 1)
    INTO v_marketplace_id, v_category_id, v_articulo_id
  FROM public.publicaciones_externas pe
  WHERE pe.id = p_publicacion_id;

  IF v_articulo_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN public.fn_resolver_regla_canonico(v_articulo_id, v_marketplace_id, v_category_id);
END;
$function$;

-- Grants
GRANT EXECUTE ON FUNCTION public.fn_resolver_regla_canonico(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolver_regla_prepublicacion(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolver_regla_pricing(UUID) TO authenticated, service_role;
