-- 20261026b: blindaje de raíz del alias de costo (importador Excel) + guarda de variante.
-- No toca el mapeo humano (mapeo_publicacion_articulo). Solo corrige el auto-match de costo.

-- =============================================================
-- 1) fn_costo_articulo_vigente: agregar guarda de variante en el fallback de hermanos
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_costo_articulo_vigente(p_articulo_id text, p_tipo_costo text)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT pp.valor
  FROM public.proveedor_articulos_alias pa
  JOIN public.precios_proveedor pp
    ON pp.proveedor = pa.proveedor
   AND pp.sku_proveedor = btrim(pa.modelo_excel)
  WHERE (
    pa.articulo_id = p_articulo_id
    OR pa.articulo_id IN (
      SELECT a2.articulo_id
      FROM public.articulos a1
      JOIN public.articulos a2
        ON lower(btrim(a2.marca)) = lower(btrim(a1.marca))
       AND lower(btrim(a2.modelo)) = lower(btrim(a1.modelo))
       AND COALESCE(lower(btrim(a2.variante)), '') = COALESCE(lower(btrim(a1.variante)), '')
      WHERE a1.articulo_id = p_articulo_id
        AND a1.marca IS NOT NULL AND btrim(a1.marca) <> ''
        AND a1.modelo IS NOT NULL AND btrim(a1.modelo) <> ''
    )
  )
    AND pa.modelo_excel IS NOT NULL
    AND btrim(pa.modelo_excel) <> ''
    AND pp.vigente = true
    AND pp.valor > 0
    AND public.fn_normalizar_tipo_costo(pp.tipo_costo)
        = public.fn_normalizar_tipo_costo(p_tipo_costo)
  ORDER BY
    CASE WHEN pa.articulo_id = p_articulo_id THEN 0 ELSE 1 END,
    pa.locked DESC,
    pa.ultima_vez_visto DESC NULLS LAST,
    pa.creado_el DESC,
    pp.creado_el DESC
  LIMIT 1;
$function$;

-- =============================================================
-- 2) fn_resolver_regla_canonico: guarda de variante en los dos fallbacks de hermanos
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_resolver_regla_canonico(p_articulo_id text, p_marketplace_id uuid, p_category_id text)
RETURNS pricing_rule_v3
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_proveedor TEXT;
  v_marca     TEXT;
  v_costo     NUMERIC;
  v_rule      public.pricing_rule_v3;
BEGIN
  SELECT pa.proveedor INTO v_proveedor
  FROM public.proveedor_articulos_alias pa
  WHERE (
    pa.articulo_id = p_articulo_id
    OR pa.articulo_id IN (
      SELECT a2.articulo_id
      FROM public.articulos a1
      JOIN public.articulos a2
        ON lower(btrim(a2.marca)) = lower(btrim(a1.marca))
       AND lower(btrim(a2.modelo)) = lower(btrim(a1.modelo))
       AND COALESCE(lower(btrim(a2.variante)), '') = COALESCE(lower(btrim(a1.variante)), '')
      WHERE a1.articulo_id = p_articulo_id
        AND a1.marca IS NOT NULL AND btrim(a1.marca) <> ''
        AND a1.modelo IS NOT NULL AND btrim(a1.modelo) <> ''
    )
  )
  ORDER BY
    CASE WHEN pa.articulo_id = p_articulo_id THEN 0 ELSE 1 END,
    pa.locked DESC,
    pa.ultima_vez_visto DESC NULLS LAST,
    pa.creado_el DESC
  LIMIT 1;

  SELECT a.marca INTO v_marca
  FROM public.articulos a
  WHERE a.articulo_id = p_articulo_id;
  IF v_marca IS NULL OR v_marca = '' THEN
    SELECT pa.marca_excel INTO v_marca
    FROM public.proveedor_articulos_alias pa
    WHERE (
      pa.articulo_id = p_articulo_id
      OR pa.articulo_id IN (
        SELECT a2.articulo_id
        FROM public.articulos a1
        JOIN public.articulos a2
          ON lower(btrim(a2.marca)) = lower(btrim(a1.marca))
         AND lower(btrim(a2.modelo)) = lower(btrim(a1.modelo))
         AND COALESCE(lower(btrim(a2.variante)), '') = COALESCE(lower(btrim(a1.variante)), '')
        WHERE a1.articulo_id = p_articulo_id
          AND a1.marca IS NOT NULL AND btrim(a1.marca) <> ''
          AND a1.modelo IS NOT NULL AND btrim(a1.modelo) <> ''
      )
    )
      AND pa.locked = true
    ORDER BY
      CASE WHEN pa.articulo_id = p_articulo_id THEN 0 ELSE 1 END,
      pa.creado_el DESC
    LIMIT 1;
  END IF;

  v_costo := public.fn_costo_articulo_vigente(p_articulo_id, 'menudeo');

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

-- =============================================================
-- 3) fn_match_articulo_proveedor: ORDER BY determinista en Nivel 1 y 2
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_match_articulo_proveedor(p_modelo text, p_marca text DEFAULT NULL::text, p_codigo text DEFAULT NULL::text)
RETURNS TABLE(articulo_id text, nombre text, marca text, modelo text, codigo_universal text, caja_madre text, puntaje_match numeric, metodo_match text, nivel_match text)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
    v_norm_marca text;
    v_norm_modelo text;
    v_norm_codigo text;
BEGIN
    v_norm_marca  := lower(unaccent(trim(COALESCE(p_marca, ''))));
    v_norm_modelo := lower(unaccent(trim(COALESCE(p_modelo, ''))));
    v_norm_codigo := lower(unaccent(trim(COALESCE(p_codigo, ''))));

    IF v_norm_codigo != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text, a.nombre::text, a.marca::text, a.modelo::text,
            a.codigo_universal::text, a.caja_madre::text,
            100::numeric, 'codigo_exacto'::text, 'actualizado_fuerte'::text
        FROM articulos a
        WHERE a.activo = true
          AND lower(unaccent(trim(COALESCE(a.codigo_universal, '')))) = v_norm_codigo
          AND lower(unaccent(trim(COALESCE(a.marca, '')))) = v_norm_marca
          AND lower(unaccent(trim(COALESCE(a.modelo, '')))) = v_norm_modelo
        ORDER BY
          (EXISTS (SELECT 1 FROM public.mapeo_publicacion_articulo m WHERE m.articulo_id = a.articulo_id)) DESC,
          (a.caja_madre IS NULL OR a.caja_madre NOT ILIKE '%devol%') DESC,
          (a.nombre IS NULL OR (a.nombre NOT ILIKE '%incompleto%' AND a.nombre NOT ILIKE '%defecto%')) DESC,
          COALESCE(a.disponibles, 0) DESC,
          a.articulo_id ASC
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    IF v_norm_marca != '' AND v_norm_modelo != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text, a.nombre::text, a.marca::text, a.modelo::text,
            a.codigo_universal::text, a.caja_madre::text,
            85::numeric, 'marca_modelo_exacto'::text, 'cambio_codigo_sugerido'::text
        FROM articulos a
        WHERE a.activo = true
          AND lower(unaccent(trim(COALESCE(a.marca, '')))) = v_norm_marca
          AND lower(unaccent(trim(COALESCE(a.modelo, '')))) = v_norm_modelo
        ORDER BY
          (EXISTS (SELECT 1 FROM public.mapeo_publicacion_articulo m WHERE m.articulo_id = a.articulo_id)) DESC,
          (a.caja_madre IS NULL OR a.caja_madre NOT ILIKE '%devol%') DESC,
          (a.nombre IS NULL OR (a.nombre NOT ILIKE '%incompleto%' AND a.nombre NOT ILIKE '%defecto%')) DESC,
          COALESCE(a.disponibles, 0) DESC,
          a.articulo_id ASC
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    IF v_norm_marca != '' OR v_norm_modelo != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text, a.nombre::text, a.marca::text, a.modelo::text,
            a.codigo_universal::text, a.caja_madre::text,
            round((similarity(
                lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))),
                v_norm_marca || ' ' || v_norm_modelo
            ) * 95)::numeric, 1), 'fuzzy_trgm'::text, 'ambiguo'::text
        FROM articulos a
        WHERE a.activo = true
          AND similarity(
              lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))),
              v_norm_marca || ' ' || v_norm_modelo
          ) > 0.2
        ORDER BY similarity(
            lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))),
            v_norm_marca || ' ' || v_norm_modelo
        ) DESC
        LIMIT 5;
    END IF;
END;
$function$;

-- =============================================================
-- 4) Re-apuntar aliases puntuales (auto-match, no mapeo humano)
-- =============================================================
UPDATE public.proveedor_articulos_alias SET articulo_id = 'NAP-62851625' WHERE articulo_id = '5c03569e';
UPDATE public.proveedor_articulos_alias SET articulo_id = '70912f46' WHERE articulo_id = 'd70eb1ad';

-- =============================================================
-- 5) fn_match_precios_v2: reemplazar MIN(articulo_id) por DISTINCT ON determinista
--    (el procesador real del Excel; este era el origen del split-brain)
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_match_precios_v2(p_importacion_id uuid, p_finalizar boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '180s'
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mapeo jsonb; v_col_modelo text; v_col_marca text; v_col_codigo text; v_col_nombre text; v_col_moneda text;
  v_moneda_default text; v_proveedor text; v_job_id uuid; v_total_filas int;
BEGIN
  SELECT mapeo_columnas, proveedor, total_filas INTO v_mapeo, v_proveedor, v_total_filas
  FROM importaciones_excel WHERE id = p_importacion_id;

  PERFORM pg_advisory_xact_lock(hashtext('precio_import_' || v_proveedor));

  SELECT id INTO v_job_id FROM matching_jobs WHERE importacion_id = p_importacion_id LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    UPDATE matching_jobs SET estado = 'corriendo', iniciado_el = now(), total = v_total_filas WHERE id = v_job_id;
  END IF;

  v_col_modelo := v_mapeo->>'columna_modelo';
  v_col_marca := v_mapeo->>'columna_marca';
  v_col_codigo := v_mapeo->>'columna_codigo';
  v_col_nombre := v_mapeo->>'columna_descripcion';
  v_col_moneda := v_mapeo->>'columna_moneda';
  v_moneda_default := COALESCE(v_mapeo->>'moneda_default', 'MXN');

  DROP TABLE IF EXISTS tmp_excel;
  CREATE TEMP TABLE tmp_excel ON COMMIT DROP AS
  SELECT
    regexp_replace(COALESCE(payload->>v_col_codigo, ''), '[^0-9A-Za-z]', '', 'g') AS codigo_excel,
    COALESCE(payload->>v_col_marca, '') AS marca_excel,
    COALESCE(payload->>v_col_modelo, '') AS modelo_excel,
    COALESCE(payload->>v_col_nombre, '') AS nombre_excel,
    COALESCE(payload->>v_col_moneda, v_moneda_default) AS moneda_excel,
    payload, fila_num
  FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

  DROP TABLE IF EXISTS tmp_resolucion;
  CREATE TEMP TABLE tmp_resolucion ON COMMIT DROP AS
  WITH e AS (SELECT * FROM tmp_excel),
  md_match AS (
    SELECT e.fila_num, md.cand_articulo_id
    FROM e JOIN matching_decisiones md
      ON md.importacion_id = p_importacion_id
     AND md.codigo_universal_excel = e.codigo_excel
     AND md.marca_excel = e.marca_excel
     AND md.modelo_excel = e.modelo_excel
     AND md.confirmado = true
  ),
  a1_match AS (
    SELECT e.fila_num, a1.articulo_id
    FROM e JOIN proveedor_articulos_alias a1
      ON a1.proveedor = v_proveedor AND a1.codigo_excel = e.codigo_excel
    WHERE e.codigo_excel <> ''
  ),
  a2_match AS (
    SELECT e.fila_num, a2.articulo_id
    FROM e JOIN proveedor_articulos_alias a2
      ON a2.proveedor = v_proveedor AND a2.marca_excel = e.marca_excel AND a2.modelo_excel = e.modelo_excel
    WHERE e.codigo_excel = ''
  ),
  a3_match AS (
    SELECT e.fila_num, a3.articulo_id
    FROM e JOIN articulos a3
      ON lower(public.f_unaccent_immutable(trim(a3.codigo_universal))) = lower(public.f_unaccent_immutable(trim(e.codigo_excel)))
    WHERE e.codigo_excel <> '' AND a3.activo = true
  )
  SELECT e.*, COALESCE(md.cand_articulo_id, a1.articulo_id, a2.articulo_id, a3.articulo_id) AS articulo_id_resuelto
  FROM e
  LEFT JOIN (
    SELECT DISTINCT ON (fila_num) fila_num, cand_articulo_id
    FROM md_match ORDER BY fila_num, cand_articulo_id ASC
  ) md ON md.fila_num = e.fila_num
  LEFT JOIN (
    SELECT DISTINCT ON (am.fila_num) am.fila_num, am.articulo_id
    FROM a1_match am JOIN articulos a ON a.articulo_id = am.articulo_id
    ORDER BY am.fila_num,
      (EXISTS (SELECT 1 FROM public.mapeo_publicacion_articulo m WHERE m.articulo_id = am.articulo_id)) DESC,
      (a.caja_madre IS NULL OR a.caja_madre NOT ILIKE '%devol%') DESC,
      (a.nombre IS NULL OR (a.nombre NOT ILIKE '%incompleto%' AND a.nombre NOT ILIKE '%defecto%')) DESC,
      COALESCE(a.disponibles, 0) DESC,
      am.articulo_id ASC
  ) a1 ON a1.fila_num = e.fila_num
  LEFT JOIN (
    SELECT DISTINCT ON (am.fila_num) am.fila_num, am.articulo_id
    FROM a2_match am JOIN articulos a ON a.articulo_id = am.articulo_id
    ORDER BY am.fila_num,
      (EXISTS (SELECT 1 FROM public.mapeo_publicacion_articulo m WHERE m.articulo_id = am.articulo_id)) DESC,
      (a.caja_madre IS NULL OR a.caja_madre NOT ILIKE '%devol%') DESC,
      (a.nombre IS NULL OR (a.nombre NOT ILIKE '%incompleto%' AND a.nombre NOT ILIKE '%defecto%')) DESC,
      COALESCE(a.disponibles, 0) DESC,
      am.articulo_id ASC
  ) a2 ON a2.fila_num = e.fila_num
  LEFT JOIN (
    SELECT DISTINCT ON (am.fila_num) am.fila_num, am.articulo_id
    FROM a3_match am JOIN articulos a ON a.articulo_id = am.articulo_id
    ORDER BY am.fila_num,
      (EXISTS (SELECT 1 FROM public.mapeo_publicacion_articulo m WHERE m.articulo_id = am.articulo_id)) DESC,
      (a.caja_madre IS NULL OR a.caja_madre NOT ILIKE '%devol%') DESC,
      (a.nombre IS NULL OR (a.nombre NOT ILIKE '%incompleto%' AND a.nombre NOT ILIKE '%defecto%')) DESC,
      COALESCE(a.disponibles, 0) DESC,
      am.articulo_id ASC
  ) a3 ON a3.fila_num = e.fila_num;

  WITH precios_expandidos AS (
    SELECT t.codigo_excel, t.marca_excel, t.modelo_excel, t.nombre_excel, t.moneda_excel, t.articulo_id_resuelto, t.fila_num,
           p->>'tipo_costo' AS tipo_costo, fn_parse_precio(t.payload->>(p->>'columna')) AS valor,
           COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva
    FROM tmp_resolucion t, jsonb_array_elements(v_mapeo->'precios') AS p
  ),
  dedup AS (
    SELECT DISTINCT ON (articulo_id_resuelto, tipo_costo) pe.*
    FROM precios_expandidos pe
    WHERE pe.valor IS NOT NULL AND pe.articulo_id_resuelto IS NOT NULL
    ORDER BY articulo_id_resuelto, tipo_costo, fila_num DESC
  )
  INSERT INTO costos_articulo (
    importacion_id, articulo_id, articulo_sugerido_id, modelo_excel, marca_excel, codigo_universal_excel,
    descripcion_excel, nombre_excel, tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
  )
  SELECT p_importacion_id, d.articulo_id_resuelto, d.articulo_id_resuelto, d.modelo_excel, d.marca_excel, d.codigo_excel,
         d.nombre_excel, d.nombre_excel, d.tipo_costo, d.valor, d.moneda_excel, 'excel', 100, 'match_exacto', true, d.incluye_iva
  FROM dedup d
  ON CONFLICT (articulo_id, tipo_costo, fuente) DO UPDATE SET
    valor = EXCLUDED.valor, moneda = EXCLUDED.moneda, importacion_id = EXCLUDED.importacion_id,
    vigente = EXCLUDED.vigente, actualizado_el = now(), incluye_iva = EXCLUDED.incluye_iva;

  WITH precios_expandidos AS (
    SELECT t.codigo_excel, t.marca_excel, t.modelo_excel, t.nombre_excel, t.moneda_excel, t.articulo_id_resuelto, t.fila_num,
           p->>'tipo_costo' AS tipo_costo, fn_parse_precio(t.payload->>(p->>'columna')) AS valor
    FROM tmp_resolucion t, jsonb_array_elements(v_mapeo->'precios') AS p
  ),
  dedup_pend AS (
    SELECT DISTINCT ON (COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo) pe.*
    FROM precios_expandidos pe
    WHERE pe.valor IS NOT NULL AND pe.articulo_id_resuelto IS NULL
    ORDER BY COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo, fila_num DESC
  )
  INSERT INTO costos_pendientes (
    importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel, tipo_costo, moneda, valor, motivo
  )
  SELECT p_importacion_id, v_proveedor, d.codigo_excel, d.marca_excel, d.modelo_excel, d.tipo_costo, d.moneda_excel, d.valor, 'sin_match'
  FROM dedup_pend d
  ON CONFLICT (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo)
  WHERE resuelto = false DO UPDATE SET
    valor = EXCLUDED.valor, importacion_id = EXCLUDED.importacion_id, actualizado_el = now();

  DELETE FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

  IF p_finalizar THEN
    UPDATE proveedor_articulos_alias SET estado_proveedor = 'descontinuado'
    WHERE proveedor = v_proveedor AND ultima_vez_visto < (now() - interval '1 day');
    PERFORM fn_marcar_vigente(p_importacion_id);
    IF v_job_id IS NOT NULL THEN
      UPDATE matching_jobs SET estado = 'completado', progreso = v_total_filas, finalizado_el = now() WHERE id = v_job_id;
    END IF;
    UPDATE importaciones_excel SET estado = 'completado', ultima_actividad = now() WHERE id = p_importacion_id;
  ELSE
    UPDATE importaciones_excel SET estado = 'procesando', ultima_actividad = now() WHERE id = p_importacion_id;
  END IF;
END;
$function$;

-- Grants
GRANT EXECUTE ON FUNCTION public.fn_costo_articulo_vigente(text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolver_regla_canonico(text,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_match_articulo_proveedor(text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_match_precios_v2(uuid,boolean) TO authenticated, service_role;
