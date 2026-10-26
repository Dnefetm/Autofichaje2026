-- Migración: 2026102602_guarda_variante_y_matcher_determinista.sql
-- Propósito:
--   1. Guarda de variante en fn_costo_articulo_vigente, fn_resolver_regla_canonico y fn_calcular_precio_prepublicacion.
--   2. Matcher determinista en fn_match_articulo_proveedor y fn_match_precios_v2 (a3_match con DISTINCT ON).
--   3. Blindaje de alias en proveedor_articulos_alias (Surtek 115200 a NAP-62851625 y Victorinox 1.3603.3 a d70eb1ad).
--   4. Recálculo de vitrinas activas para evitar missing_cost.

-- =============================================================
-- 1) fn_costo_articulo_vigente: guarda de variante en hermanos
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
-- 2) fn_resolver_regla_canonico: guarda de variante en hermanos
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
-- 3) fn_calcular_precio_prepublicacion: guarda de variante en hermanos
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_calcular_precio_prepublicacion(
  p_articulo_id text,
  p_marketplace_id uuid,
  p_category_id text,
  p_listing_type_id text,
  p_force_rule_id uuid DEFAULT NULL::uuid,
  p_cantidad_requerida integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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

  v_rule := public.fn_resolver_regla_prepublicacion(p_articulo_id, p_marketplace_id, p_category_id);

  IF p_force_rule_id IS NOT NULL THEN
    SELECT * INTO v_rule FROM public.pricing_rule_v3 WHERE id = p_force_rule_id AND is_active = true;
  END IF;

  IF v_rule IS NULL THEN
    RETURN jsonb_build_object('status','no_rule','sale_price',NULL,'proveedor',v_proveedor,'reason','Sin regla de precio para este artículo/tienda/categoría');
  END IF;

  v_costo_base := public.fn_costo_articulo_vigente(p_articulo_id, v_rule.cost_basis)
                  * GREATEST(1, COALESCE(p_cantidad_requerida, 1));
  IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
    RETURN jsonb_build_object('status','missing_cost','sale_price',NULL,'proveedor',v_proveedor,'cost_basis',v_rule.cost_basis,'reason','Sin costo vigente ('||v_rule.cost_basis||') para este artículo');
  END IF;

  SELECT commission_effective, withholding_effective
    INTO v_commission_pct, v_withholding_pct
  FROM public.v_category_pricing_params
  WHERE category_id = p_category_id
    AND listing_type_id = p_listing_type_id
  ORDER BY commission_source DESC NULLS LAST, withholding_source DESC NULLS LAST, commission_effective DESC, withholding_effective DESC
  LIMIT 1;

  IF v_commission_pct IS NULL THEN
    v_commission_pct := 15.0;
    v_withholding_pct := 8.96;
  END IF;

  v_comision_efectiva    := CASE WHEN COALESCE(v_rule.aplicar_comision, true)    THEN v_commission_pct  ELSE 0.0 END;
  v_retenciones_efectiva := CASE WHEN COALESCE(v_rule.aplicar_retenciones, true) THEN v_withholding_pct ELSE 0.0 END;

  v_numerador := v_costo_base * (1.0 + (CASE WHEN COALESCE(v_rule.aplicar_margen, true) THEN v_rule.margen_objetivo ELSE 0.0 END)/100.0)
                 + (CASE WHEN COALESCE(v_rule.aplicar_envio, true) THEN COALESCE(v_rule.envio_fijo,0) ELSE 0.0 END);
  v_denominador := 1.0 - (v_comision_efectiva + v_retenciones_efectiva)/100.0;

  IF v_denominador <= 0 THEN
    RETURN jsonb_build_object('status','invalid_strategy','sale_price',NULL,'proveedor',v_proveedor,'reason','Comisión + retenciones >= 100%');
  END IF;

  v_precio_final := v_numerador / v_denominador;

  v_precio_final := CASE v_rule.redondeo
    WHEN '99' THEN FLOOR(v_precio_final / 10) * 10 + 9
    WHEN '00' THEN ROUND(v_precio_final / 10) * 10
    WHEN '5'  THEN ROUND(v_precio_final / 5)  * 5
    ELSE ROUND(v_precio_final, 2)
  END;

  RETURN jsonb_build_object(
    'status','valid','sale_price',v_precio_final,'base_price',v_costo_base,'currency','MXN',
    'proveedor',v_proveedor,'rule_id',v_rule.id,'rule_name',v_rule.name,'cost_basis',v_rule.cost_basis,
    'margen_pct',v_rule.margen_objetivo,'comision_pct',v_comision_efectiva,'retenciones_pct',v_retenciones_efectiva,
    'envio_fijo',v_rule.envio_fijo,'listing_type_id',p_listing_type_id,'cantidad_requerida',GREATEST(1, COALESCE(p_cantidad_requerida,1))
  );
END;
$function$;

-- =============================================================
-- 4) fn_match_articulo_proveedor: matcher determinista Nivel 1 y 2
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_match_articulo_proveedor(
  p_modelo text,
  p_marca text DEFAULT NULL::text,
  p_codigo text DEFAULT NULL::text
)
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
-- 5) fn_match_precios_v2: DISTINCT ON determinista en a3_match
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

-- =============================================================
-- 6) Datos de Surtek 115200 y Victorinox 1.3603.3
-- =============================================================
-- Surtek 115200 apunta a NAP-62851625
UPDATE public.proveedor_articulos_alias
SET articulo_id = 'NAP-62851625'
WHERE modelo_excel = '115200' AND articulo_id != 'NAP-62851625';

-- Victorinox 1.3603.3 apunta a d70eb1ad (mapeo activo de vitrinas)
UPDATE public.proveedor_articulos_alias
SET articulo_id = 'd70eb1ad'
WHERE modelo_excel = '1.3603.3' AND proveedor = 'Victorinox';

-- Recalcular las 4 vitrinas activas para garantizar pricing_status = 'valid' y draft_cost = 715.00
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT id FROM public.publicaciones_externas
    WHERE external_item_id IN ('MLM2761500462', 'MLM4335159640', 'MLM2761687748', 'MLM6342485736')
  ) LOOP
    PERFORM public.fn_recalcular_precio_publicacion(r.id);
  END LOOP;
END $$;

-- =============================================================
-- 7) Permisos / Grants
-- =============================================================
GRANT EXECUTE ON FUNCTION public.fn_costo_articulo_vigente(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolver_regla_canonico(text, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_calcular_precio_prepublicacion(text, uuid, text, text, uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_match_articulo_proveedor(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_match_precios_v2(uuid, boolean) TO authenticated, service_role;
