-- Migration: v115_perf_refactor_set_based (Refined)
-- Fecha: 2026-05-22
-- Propósito: 
-- Refactorizar fn_resolver_y_poblar_costos y fn_match_precios_v2 a set-based (LEFT JOINs).
-- Incluye sugerencias de robustez (DROP TABLE IF EXISTS, LEFT JOIN LATERAL, NOT EXISTS).

BEGIN;

-- 0. Pre-requisitos e Índices Funcionales (Idempotentes)
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.f_unaccent_immutable(t text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT public.unaccent('public.unaccent', t) $$;

CREATE INDEX IF NOT EXISTS ix_paa_codigo_norm
  ON proveedor_articulos_alias ((lower(public.f_unaccent_immutable(trim(codigo_excel)))))
  WHERE articulo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_paa_modelo_norm
  ON proveedor_articulos_alias ((lower(public.f_unaccent_immutable(trim(modelo_excel)))))
  WHERE articulo_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_art_modelo_norm
  ON articulos ((lower(public.f_unaccent_immutable(trim(modelo)))));

CREATE INDEX IF NOT EXISTS ix_art_codigo_norm
  ON articulos ((lower(public.f_unaccent_immutable(trim(codigo_universal)))))
  WHERE activo = true;

CREATE INDEX IF NOT EXISTS ix_paa_prov_codigo
  ON proveedor_articulos_alias (proveedor, codigo_excel);

CREATE INDEX IF NOT EXISTS ix_paa_prov_marca_modelo
  ON proveedor_articulos_alias (proveedor, marca_excel, modelo_excel);

CREATE INDEX IF NOT EXISTS ix_md_imp_keys_confirmado
  ON matching_decisiones (importacion_id, codigo_universal_excel, marca_excel, modelo_excel)
  WHERE confirmado = true;

CREATE INDEX IF NOT EXISTS ix_lpr_imp
  ON listas_precios_raw (importacion_id);

CREATE INDEX IF NOT EXISTS ix_lprs_imp
  ON listas_precios_raw_staging (importacion_id);


-- =====================================================================
-- 1. Refactor de fn_resolver_y_poblar_costos
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_resolver_y_poblar_costos(
  p_importacion_id uuid,
  p_proveedor      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '180s'
AS $function$
DECLARE
  v_mapeo               jsonb;
  v_col_modelo          text;
  v_col_codigo          text;
  v_col_marca           text;
  v_col_desc            text;
  v_moneda              text;
  v_precios             jsonb;
  v_resueltos           int := 0;
  v_pendientes          int := 0;
  v_modelos_resueltos   int := 0;
  v_modelos_pendientes  int := 0;
BEGIN
  SELECT mapeo_columnas INTO v_mapeo
    FROM importaciones_excel
   WHERE id = p_importacion_id;

  v_col_modelo := v_mapeo->>'columna_modelo';
  v_col_codigo := v_mapeo->>'columna_codigo';
  v_col_marca  := v_mapeo->>'columna_marca';
  v_col_desc   := v_mapeo->>'columna_descripcion';
  v_moneda     := COALESCE(v_mapeo->>'moneda_default','MXN');
  v_precios    := v_mapeo->'precios';

  -- CTE principal
  DROP TABLE IF EXISTS tmp_filas_raw;
  CREATE TEMP TABLE tmp_filas_raw ON COMMIT DROP AS
  SELECT payload, fila_num, lower(public.f_unaccent_immutable(trim(payload->>v_col_modelo))) AS modelo_norm
  FROM listas_precios_raw
  WHERE importacion_id = p_importacion_id
    AND COALESCE(payload->>v_col_modelo,'') <> '';

  -- --------------------------------------------------------
  -- FASE RESUELTOS
  -- --------------------------------------------------------
  WITH alias_match AS (
    SELECT f.fila_num, a.articulo_id
      FROM tmp_filas_raw f
      JOIN proveedor_articulos_alias a
        ON a.proveedor = p_proveedor
       AND a.articulo_id IS NOT NULL
       AND (
         lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.modelo_norm OR
         lower(public.f_unaccent_immutable(trim(a.modelo_excel))) = f.modelo_norm
       )
  ),
  resueltos AS (
    SELECT f.payload, f.fila_num, am.articulo_id
      FROM tmp_filas_raw f
      LEFT JOIN LATERAL (
        SELECT m.articulo_id FROM alias_match m WHERE m.fila_num = f.fila_num LIMIT 1
      ) am ON true
      WHERE am.articulo_id IS NOT NULL
  ),
  expand AS (
    SELECT r.articulo_id,
           r.payload,
           r.fila_num,
           p->>'columna'                AS precio_col,
           p->>'tipo_costo'             AS tipo_costo,
           (p->>'incluye_iva')::boolean AS incluye_iva
      FROM resueltos r,
           jsonb_array_elements(v_precios) p
  ),
  dedup AS (
    SELECT DISTINCT ON (articulo_id, tipo_costo)
      articulo_id,
      p_importacion_id AS importacion_id,
      payload->>v_col_modelo AS modelo_excel,
      payload->>v_col_marca AS marca_excel,
      payload->>v_col_codigo AS codigo_universal_excel,
      payload->>v_col_desc AS descripcion_excel,
      tipo_costo,
      NULLIF(regexp_replace(COALESCE(payload->>precio_col,'0'),'[^0-9.-]','','g'),'')::numeric AS valor,
      v_moneda AS moneda,
      'excel' AS fuente,
      'confirmado' AS estado_match,
      true AS vigente,
      incluye_iva
    FROM expand e
    WHERE COALESCE(e.payload->>e.precio_col,'') <> ''
      AND NULLIF(regexp_replace(COALESCE(e.payload->>e.precio_col,'0'),'[^0-9.-]','','g'),'')::numeric > 0
    ORDER BY articulo_id, tipo_costo, fila_num DESC
  ),
  upsert_costos AS (
    INSERT INTO costos_articulo (
      articulo_id, importacion_id, modelo_excel, marca_excel,
      codigo_universal_excel, descripcion_excel, tipo_costo,
      valor, moneda, fuente, estado_match, vigente, incluye_iva
    )
    SELECT
      articulo_id, importacion_id, modelo_excel, marca_excel,
      codigo_universal_excel, descripcion_excel, tipo_costo,
      valor, moneda, fuente, estado_match, vigente, incluye_iva
    FROM dedup
    ON CONFLICT (articulo_id, tipo_costo, fuente) DO UPDATE SET
      importacion_id          = EXCLUDED.importacion_id,
      valor                   = EXCLUDED.valor,
      moneda                  = EXCLUDED.moneda,
      modelo_excel            = EXCLUDED.modelo_excel,
      marca_excel             = EXCLUDED.marca_excel,
      codigo_universal_excel  = EXCLUDED.codigo_universal_excel,
      descripcion_excel       = EXCLUDED.descripcion_excel,
      estado_match            = 'confirmado',
      vigente                 = true,
      incluye_iva             = EXCLUDED.incluye_iva,
      actualizado_el          = now()
    RETURNING articulo_id
  )
  SELECT count(*), count(DISTINCT articulo_id)
    INTO v_resueltos, v_modelos_resueltos
    FROM upsert_costos;

  -- --------------------------------------------------------
  -- FASE HUÉRFANOS (PENDIENTES)
  -- --------------------------------------------------------
  WITH huerfanos AS (
    SELECT f.payload, f.fila_num
      FROM tmp_filas_raw f
     WHERE NOT EXISTS (
             SELECT 1 FROM proveedor_articulos_alias a
              WHERE a.proveedor = p_proveedor
                AND a.articulo_id IS NOT NULL
                AND (lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.modelo_norm
                  OR lower(public.f_unaccent_immutable(trim(a.modelo_excel))) = f.modelo_norm))
       AND NOT EXISTS (
             SELECT 1 FROM articulos ar
              WHERE lower(public.f_unaccent_immutable(trim(ar.modelo))) = f.modelo_norm)
  ),
  expand AS (
    SELECT h.payload,
           h.fila_num,
           p->>'columna'    AS precio_col,
           p->>'tipo_costo' AS tipo_costo
      FROM huerfanos h,
           jsonb_array_elements(v_precios) p
  ),
  dedup_pend AS (
    SELECT DISTINCT ON (COALESCE(payload->>v_col_codigo,''), COALESCE(payload->>v_col_marca,''), COALESCE(payload->>v_col_modelo,''), tipo_costo, importacion_id)
      COALESCE(payload->>v_col_codigo,'') AS codigo_excel,
      COALESCE(payload->>v_col_marca,'') AS marca_excel,
      COALESCE(payload->>v_col_modelo,'') AS modelo_excel,
      tipo_costo,
      NULLIF(regexp_replace(COALESCE(payload->>precio_col,'0'),'[^0-9.-]','','g'),'')::numeric AS valor,
      p_importacion_id AS importacion_id
    FROM expand e
    WHERE COALESCE(e.payload->>e.precio_col,'') <> ''
    ORDER BY COALESCE(payload->>v_col_codigo,''), COALESCE(payload->>v_col_marca,''), COALESCE(payload->>v_col_modelo,''), tipo_costo, importacion_id, fila_num DESC
  ),
  upsert_pend AS (
    INSERT INTO costos_pendientes (
      importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel,
      tipo_costo, moneda, valor, motivo, resuelto
    )
    SELECT
      importacion_id, p_proveedor,
      codigo_excel,
      marca_excel,
      modelo_excel,
      tipo_costo, v_moneda,
      valor,
      'sin_alias_ni_articulo', false
    FROM dedup_pend
    ON CONFLICT (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo, importacion_id)
      WHERE (resuelto = false)
    DO UPDATE SET
      importacion_id = EXCLUDED.importacion_id,
      valor          = EXCLUDED.valor,
      moneda         = EXCLUDED.moneda,
      motivo         = EXCLUDED.motivo,
      actualizado_el = now()
    RETURNING modelo_excel
  )
  SELECT count(*), count(DISTINCT modelo_excel)
    INTO v_pendientes, v_modelos_pendientes
    FROM upsert_pend;

  DROP TABLE IF EXISTS tmp_filas_raw;

  RETURN jsonb_build_object(
    'costos_resueltos',    v_resueltos,
    'modelos_resueltos',   v_modelos_resueltos,
    'costos_pendientes',   v_pendientes,
    'modelos_pendientes',  v_modelos_pendientes
  );
END;
$function$;


-- =====================================================================
-- 2. Refactor de fn_match_precios_v2
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_match_precios_v2(p_importacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '180s'
AS $$
DECLARE
    v_mapeo jsonb;
    v_col_modelo text;
    v_col_marca text;
    v_col_codigo text;
    v_col_nombre text;
    v_col_moneda text;
    v_moneda_default text;
    v_proveedor text;
    v_job_id uuid;
    v_total_filas int;
BEGIN
    SELECT mapeo_columnas, proveedor, total_filas INTO v_mapeo, v_proveedor, v_total_filas
    FROM importaciones_excel 
    WHERE id = p_importacion_id;

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
        payload,
        fila_num
    FROM listas_precios_raw_staging
    WHERE importacion_id = p_importacion_id;

    DROP TABLE IF EXISTS tmp_resolucion;
    CREATE TEMP TABLE tmp_resolucion ON COMMIT DROP AS
    WITH e AS (SELECT * FROM tmp_excel),
    md_match AS (
      SELECT e.fila_num, md.cand_articulo_id
        FROM e
        JOIN matching_decisiones md
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
          ON a2.proveedor = v_proveedor
         AND a2.marca_excel = e.marca_excel
         AND a2.modelo_excel = e.modelo_excel
       WHERE e.codigo_excel = ''
    ),
    a3_match AS (
      SELECT e.fila_num, a3.articulo_id
        FROM e JOIN articulos a3
          ON lower(public.f_unaccent_immutable(trim(a3.codigo_universal))) = lower(public.f_unaccent_immutable(trim(e.codigo_excel)))
       WHERE e.codigo_excel <> '' AND a3.activo = true
    )
    SELECT
      e.*,
      COALESCE(
        (SELECT md.cand_articulo_id FROM md_match md WHERE md.fila_num = e.fila_num LIMIT 1),
        (SELECT a1.articulo_id FROM a1_match a1 WHERE a1.fila_num = e.fila_num LIMIT 1),
        (SELECT a2.articulo_id FROM a2_match a2 WHERE a2.fila_num = e.fila_num LIMIT 1),
        (SELECT a3.articulo_id FROM a3_match a3 WHERE a3.fila_num = e.fila_num LIMIT 1)
      ) AS articulo_id_resuelto
    FROM e;

    WITH precios_expandidos AS (
        SELECT 
            t.codigo_excel, t.marca_excel, t.modelo_excel, t.nombre_excel, t.moneda_excel,
            t.articulo_id_resuelto,
            t.fila_num,
            p->>'tipo_costo' AS tipo_costo,
            fn_parse_precio(t.payload->>(p->>'columna')) AS valor,
            COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva
        FROM tmp_resolucion t,
             jsonb_array_elements(v_mapeo->'precios') AS p
    ),
    dedup AS (
        SELECT DISTINCT ON (articulo_id_resuelto, tipo_costo)
            pe.*
        FROM precios_expandidos pe
        WHERE pe.valor IS NOT NULL AND pe.articulo_id_resuelto IS NOT NULL
        ORDER BY articulo_id_resuelto, tipo_costo, fila_num DESC
    )
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT 
        p_importacion_id,
        d.articulo_id_resuelto,
        d.articulo_id_resuelto,
        d.modelo_excel, d.marca_excel, d.codigo_excel, d.nombre_excel, d.nombre_excel,
        d.tipo_costo, d.valor, d.moneda_excel, 'excel', 
        100, 
        'completado', 
        true, 
        d.incluye_iva
    FROM dedup d
    ON CONFLICT (articulo_id, tipo_costo, fuente) DO UPDATE SET
        valor = EXCLUDED.valor,
        moneda = EXCLUDED.moneda,
        importacion_id = EXCLUDED.importacion_id,
        vigente = EXCLUDED.vigente,
        actualizado_el = now(),
        incluye_iva = EXCLUDED.incluye_iva;

    WITH precios_expandidos AS (
        SELECT 
            t.codigo_excel, t.marca_excel, t.modelo_excel, t.nombre_excel, t.moneda_excel,
            t.articulo_id_resuelto,
            t.fila_num,
            p->>'tipo_costo' AS tipo_costo,
            fn_parse_precio(t.payload->>(p->>'columna')) AS valor
        FROM tmp_resolucion t,
             jsonb_array_elements(v_mapeo->'precios') AS p
    ),
    dedup_pend AS (
        SELECT DISTINCT ON (COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo, p_importacion_id)
            pe.*
        FROM precios_expandidos pe
        WHERE pe.valor IS NOT NULL AND pe.articulo_id_resuelto IS NULL
        ORDER BY COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo, p_importacion_id, fila_num DESC
    )
    INSERT INTO costos_pendientes (
        importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel, tipo_costo, moneda, valor, motivo
    )
    SELECT 
        p_importacion_id, v_proveedor, d.codigo_excel, d.marca_excel, d.modelo_excel, d.tipo_costo, d.moneda_excel, d.valor,
        'sin_match'
    FROM dedup_pend d
    ON CONFLICT (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo, importacion_id) 
    WHERE resuelto = false 
    DO UPDATE SET 
        valor = EXCLUDED.valor,
        actualizado_el = now();

    DELETE FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

    UPDATE proveedor_articulos_alias
    SET estado_proveedor = 'descontinuado'
    WHERE proveedor = v_proveedor
      AND ultima_vez_visto < (now() - interval '1 day');

    PERFORM fn_marcar_vigente(p_importacion_id);

    IF v_job_id IS NOT NULL THEN
        UPDATE matching_jobs SET estado = 'completado', progreso = v_total_filas, finalizado_el = now() WHERE id = v_job_id;
    END IF;

    UPDATE importaciones_excel SET estado = 'completado', ultima_actividad = now() WHERE id = p_importacion_id;
END;
$$;

COMMIT;
