-- Migration: v115.1_chunked_processing
-- Fecha: 2026-05-24
-- Propósito: 
-- 1. Actualizar fn_match_precios_v2 para incluir 'p_finalizar boolean DEFAULT true'.
-- 2. Resolver el Bug C (N-ejecuciones de finalización) aislando la lógica final de descontinuados y estados en un bloque IF.
-- 3. Crear wrapper atómico fn_match_precios_v2_chunked que maneja el UNLOGGED TABLE backup y transfiere chunks al staging principal.

BEGIN;

-- =====================================================================
-- 1. Refactor de fn_match_precios_v2 (v115.1)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_match_precios_v2(
  p_importacion_id uuid,
  p_finalizar boolean DEFAULT true
)
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

    -- SOLUCIÓN BUG C: Bloque de finalización condicionado a p_finalizar
    IF p_finalizar THEN
        UPDATE proveedor_articulos_alias
        SET estado_proveedor = 'descontinuado'
        WHERE proveedor = v_proveedor
          AND ultima_vez_visto < (now() - interval '1 day');

        PERFORM fn_marcar_vigente(p_importacion_id);

        IF v_job_id IS NOT NULL THEN
            UPDATE matching_jobs SET estado = 'completado', progreso = v_total_filas, finalizado_el = now() WHERE id = v_job_id;
        END IF;

        UPDATE importaciones_excel SET estado = 'completado', ultima_actividad = now() WHERE id = p_importacion_id;
    ELSE
        -- Chunk intermedio: solo actualizar actividad (mantener 'procesando')
        UPDATE importaciones_excel SET estado = 'procesando', ultima_actividad = now() WHERE id = p_importacion_id;
    END IF;
END;
$$;

-- =====================================================================
-- 2. Wrapper Definitivo para Chunking (v115.1)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_match_precios_v2_chunked(
  p_importacion_id UUID,
  p_chunk_size INT DEFAULT 500
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_backup_count INT;
  v_staging_count INT;
  v_movidos INT;
  v_finalizar BOOLEAN := false;
BEGIN
  -- 1. Crear tabla de backup y asegurar permisos dinámicamente
  EXECUTE 'CREATE UNLOGGED TABLE IF NOT EXISTS public.listas_precios_raw_staging_backup (
    LIKE public.listas_precios_raw_staging INCLUDING ALL
  )';
  EXECUTE 'ALTER TABLE public.listas_precios_raw_staging_backup ENABLE ROW LEVEL SECURITY';
  EXECUTE 'REVOKE ALL ON public.listas_precios_raw_staging_backup FROM PUBLIC, anon, authenticated';

  -- 2. Revisar filas actuales en staging y backup
  SELECT count(*) INTO v_staging_count FROM public.listas_precios_raw_staging WHERE importacion_id = p_importacion_id;
  EXECUTE 'SELECT count(*) FROM public.listas_precios_raw_staging_backup WHERE importacion_id = $1' 
    INTO v_backup_count USING p_importacion_id;

  -- 3. Si es la primera llamada (staging lleno, backup vacío), movemos TODO a backup
  IF v_staging_count > 0 AND v_backup_count = 0 THEN
    EXECUTE 'INSERT INTO public.listas_precios_raw_staging_backup SELECT * FROM public.listas_precios_raw_staging WHERE importacion_id = $1' 
      USING p_importacion_id;

    DELETE FROM public.listas_precios_raw_staging
    WHERE importacion_id = p_importacion_id;

    v_backup_count := v_staging_count;
    v_staging_count := 0;
  END IF;

  -- 4. Si staging está vacío y hay datos en backup, transferimos 1 chunk al staging
  IF v_staging_count = 0 AND v_backup_count > 0 THEN
    EXECUTE '
      WITH movidos AS (
        DELETE FROM public.listas_precios_raw_staging_backup
        WHERE ctid IN (
          SELECT ctid 
          FROM public.listas_precios_raw_staging_backup
          WHERE importacion_id = $1
          ORDER BY fila_num ASC
          LIMIT $2
        )
        RETURNING *
      )
      INSERT INTO public.listas_precios_raw_staging
      SELECT * FROM movidos'
    USING p_importacion_id, p_chunk_size;

    GET DIAGNOSTICS v_movidos = ROW_COUNT;
    v_backup_count := v_backup_count - v_movidos;
    v_staging_count := v_movidos;
  END IF;

  -- 5. Procesar el chunk que ahora está en staging
  IF v_staging_count > 0 THEN
    -- Si el backup ya quedó vacío, este es el último chunk. Autorizamos la finalización.
    IF v_backup_count = 0 THEN
      v_finalizar := true;
    END IF;

    PERFORM public.fn_match_precios_v2(p_importacion_id, v_finalizar);
  ELSE
    -- Failsafe
    UPDATE importaciones_excel 
    SET estado = 'completado', ultima_actividad = now() 
    WHERE id = p_importacion_id AND estado = 'procesando';
  END IF;
END;
$$;

-- =====================================================================
-- 3. Permisos y Seguridad (Funciones)
-- =====================================================================
GRANT EXECUTE ON FUNCTION public.fn_match_precios_v2_chunked(uuid, int) TO authenticated, service_role;

COMMIT;
