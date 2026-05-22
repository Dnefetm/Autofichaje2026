-- Migration: v113_fix_dedup_match_y_resolver
-- Fecha: 2026-05-21
-- Propósito: 
-- 1. Deduplicar internamente los Excel al hacer UPSERT en costos_articulo (error 21000).
-- 2. Limpiar columna 'modo' legacy.

BEGIN;

-- =====================================================================
-- 1. fn_resolver_y_poblar_costos
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_resolver_y_poblar_costos(
  p_importacion_id uuid,
  p_proveedor      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

  WITH filas AS (
    SELECT r.payload, r.fila_num
      FROM listas_precios_raw r
     WHERE r.importacion_id = p_importacion_id
       AND COALESCE(r.payload->>v_col_modelo,'') <> ''
  ),
  resueltos AS (
    SELECT f.payload, f.fila_num,
           (
             SELECT a.articulo_id
               FROM proveedor_articulos_alias a
              WHERE a.proveedor   = p_proveedor
                AND a.articulo_id IS NOT NULL
                AND ( lower(unaccent(trim(a.codigo_excel))) = lower(unaccent(trim(f.payload->>v_col_modelo)))
                   OR lower(unaccent(trim(a.modelo_excel))) = lower(unaccent(trim(f.payload->>v_col_modelo))) )
              LIMIT 1
           ) AS articulo_id
      FROM filas f
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
     WHERE r.articulo_id IS NOT NULL
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

  WITH filas AS (
    SELECT r.payload, r.fila_num
      FROM listas_precios_raw r
     WHERE r.importacion_id = p_importacion_id
       AND COALESCE(r.payload->>v_col_modelo,'') <> ''
  ),
  huerfanos AS (
    SELECT f.payload, f.fila_num
      FROM filas f
     WHERE NOT EXISTS (
             SELECT 1 FROM proveedor_articulos_alias a
              WHERE a.proveedor   = p_proveedor
                AND a.articulo_id IS NOT NULL
                AND ( lower(unaccent(trim(a.codigo_excel))) = lower(unaccent(trim(f.payload->>v_col_modelo)))
                   OR lower(unaccent(trim(a.modelo_excel))) = lower(unaccent(trim(f.payload->>v_col_modelo))) )
           )
       AND NOT EXISTS (
             SELECT 1 FROM articulos ar
              WHERE lower(unaccent(trim(ar.modelo))) = lower(unaccent(trim(f.payload->>v_col_modelo)))
           )
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

  RETURN jsonb_build_object(
    'costos_resueltos',    v_resueltos,
    'modelos_resueltos',   v_modelos_resueltos,
    'costos_pendientes',   v_pendientes,
    'modelos_pendientes',  v_modelos_pendientes
  );
END;
$function$;

-- =====================================================================
-- 2. fn_match_precios_v2
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_match_precios_v2(p_importacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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

    CREATE TEMP TABLE tmp_excel ON COMMIT DROP AS
    SELECT 
        COALESCE(payload->>v_col_codigo, '') AS codigo_excel,
        COALESCE(payload->>v_col_marca, '') AS marca_excel,
        COALESCE(payload->>v_col_modelo, '') AS modelo_excel,
        COALESCE(payload->>v_col_nombre, '') AS nombre_excel,
        COALESCE(payload->>v_col_moneda, v_moneda_default) AS moneda_excel,
        payload,
        fila_num
    FROM listas_precios_raw_staging
    WHERE importacion_id = p_importacion_id;

    UPDATE tmp_excel SET codigo_excel = regexp_replace(codigo_excel, '[^0-9A-Za-z]', '', 'g') WHERE codigo_excel <> '';

    CREATE TEMP TABLE tmp_resolucion ON COMMIT DROP AS
    SELECT 
        e.*,
        COALESCE(
            (SELECT md.cand_articulo_id FROM matching_decisiones md WHERE md.importacion_id = p_importacion_id AND md.codigo_universal_excel = e.codigo_excel AND md.marca_excel = e.marca_excel AND md.modelo_excel = e.modelo_excel AND md.confirmado = true LIMIT 1),
            (SELECT a1.articulo_id FROM proveedor_articulos_alias a1 WHERE a1.proveedor = v_proveedor AND a1.codigo_excel = e.codigo_excel AND e.codigo_excel <> '' LIMIT 1),
            (SELECT a2.articulo_id FROM proveedor_articulos_alias a2 WHERE a2.proveedor = v_proveedor AND a2.marca_excel = e.marca_excel AND a2.modelo_excel = e.modelo_excel AND (e.codigo_excel = '' OR e.codigo_excel IS NULL) LIMIT 1),
            (SELECT a3.articulo_id FROM articulos a3 WHERE lower(unaccent(trim(a3.codigo_universal))) = lower(unaccent(trim(e.codigo_excel))) AND e.codigo_excel <> '' AND a3.activo = true LIMIT 1)
        ) AS articulo_id_resuelto
    FROM tmp_excel e;

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

-- =====================================================================
-- 3. Limpieza de columna legacy 'modo'
-- =====================================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='importaciones_excel' AND column_name='modo'
    ) THEN
        UPDATE importaciones_excel 
           SET modo_carga = modo 
         WHERE modo_carga IS NULL 
           AND modo IS NOT NULL;

        ALTER TABLE importaciones_excel DROP COLUMN modo;
    END IF;
END $$;

COMMIT;
