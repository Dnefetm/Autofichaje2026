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
  -- Se usa ILIKE y string_to_array para permitir listas separadas por comas (ej. "Urrea, Surtek, Foy")
  SELECT * INTO v_rule
  FROM pricing_rule_v3 r
  WHERE r.is_active = true
    AND (r.marketplace_id IS NULL OR r.marketplace_id = v_pub.marketplace_id)
    AND (r.marca IS NULL OR v_pub.marca ILIKE ANY(string_to_array(replace(r.marca, ', ', ','), ',')))
    AND (r.category_id IS NULL OR v_pub.category_id ILIKE ANY(string_to_array(replace(r.category_id, ', ', ','), ',')))
    AND (r.articulo_id IS NULL OR r.articulo_id = v_pub.articulo_id)
    AND (r.precio_min IS NULL OR v_costo >= r.precio_min)
    AND (r.precio_max IS NULL OR v_costo <= r.precio_max)
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

COMMIT;
