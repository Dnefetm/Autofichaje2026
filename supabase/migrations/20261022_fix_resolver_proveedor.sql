-- 20261022: fn_resolver_regla_pricing respeta `proveedor` (reglas por proveedor).
-- Bug: el resolutor ignoraba `proveedor` y trataba `marca=''` como "coincide con todo",
-- por lo que la regla "DAI Refacciones" (proveedor='DAI Autopartes', marca='', distribuidor)
-- se aplicaba a TODOS los artículos no-Urrea (incluido Tuk) y rompía el precio sugerido.
CREATE OR REPLACE FUNCTION public.fn_resolver_regla_pricing(p_publicacion_id uuid)
 RETURNS pricing_rule_v3
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE v_pub RECORD; v_costo NUMERIC; v_rule pricing_rule_v3; v_marca TEXT; v_proveedor TEXT;
BEGIN
  SELECT pe.id, pe.marketplace_id, pe.category_id,
         (SELECT m.articulo_id FROM mapeo_publicacion_articulo m WHERE m.publicacion_id = pe.id LIMIT 1) AS articulo_id,
         (SELECT a.marca FROM articulos a WHERE a.articulo_id = (SELECT m.articulo_id FROM mapeo_publicacion_articulo m WHERE m.publicacion_id = pe.id LIMIT 1)) AS marca
    INTO v_pub
  FROM publicaciones_externas pe WHERE pe.id = p_publicacion_id;

  -- Proveedor del artículo (para respetar reglas por proveedor)
  SELECT proveedor INTO v_proveedor
  FROM proveedor_articulos_alias
  WHERE articulo_id = v_pub.articulo_id
  ORDER BY locked DESC, creado_el DESC
  LIMIT 1;

  IF v_pub.marca IS NULL THEN
      SELECT marca_excel INTO v_pub.marca FROM proveedor_articulos_alias WHERE articulo_id = v_pub.articulo_id AND locked = true LIMIT 1;
  END IF;

  SELECT c.valor INTO v_costo
  FROM costos_articulo c
  WHERE c.articulo_id = v_pub.articulo_id AND c.vigente = true AND lower(c.tipo_costo) = 'menudeo'
  ORDER BY c.creado_el DESC LIMIT 1;

  SELECT * INTO v_rule
  FROM pricing_rule_v3 r
  WHERE r.is_active = true
    AND (r.proveedor IS NULL OR r.proveedor = '' OR r.proveedor = v_proveedor)
    AND (r.marketplace_id IS NULL OR r.marketplace_id = v_pub.marketplace_id)
    AND (r.marca IS NULL OR r.marca = '' OR v_pub.marca ILIKE ANY (string_to_array(r.marca, ', ')))
    AND (r.category_id IS NULL OR r.category_id = '' OR r.category_id = v_pub.category_id)
    AND (r.articulo_id IS NULL OR r.articulo_id = '' OR r.articulo_id = v_pub.articulo_id)
    AND (r.precio_min IS NULL OR v_costo >= r.precio_min)
    AND (r.precio_max IS NULL OR v_costo <= r.precio_max)
  ORDER BY
    (CASE WHEN r.proveedor IS NOT NULL AND r.proveedor != '' THEN 1 ELSE 0 END
   + CASE WHEN r.articulo_id IS NOT NULL AND r.articulo_id != '' THEN 1 ELSE 0 END
   + CASE WHEN r.category_id IS NOT NULL AND r.category_id != '' THEN 1 ELSE 0 END
   + CASE WHEN r.marca IS NOT NULL AND r.marca != '' THEN 1 ELSE 0 END
   + CASE WHEN r.marketplace_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.precio_min IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.precio_max IS NOT NULL THEN 1 ELSE 0 END) DESC,
    r.priority ASC
  LIMIT 1;

  RETURN v_rule;
END $function$;
