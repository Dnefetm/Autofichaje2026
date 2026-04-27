-- =============================================================================
-- MIGRACIÓN v79: Fix Matching Coverage & UI Stats
-- Agrega la Ola 4 para garantizar 100% de cobertura en matching_decisiones
-- y un RPC de conteo rápido para la UI.
-- =============================================================================

BEGIN;

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
    v_raws_count int;
    v_decisiones_count int;
BEGIN
    -- Obtener la importación
    SELECT mapeo_columnas, proveedor, total_filas INTO v_mapeo, v_proveedor, v_total_filas
    FROM importaciones_excel 
    WHERE id = p_importacion_id;

    -- Registrar inicio de la operación
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

    -- Crear una vista materializada temporal del excel deduplicada para agilizar (idempotente)
    CREATE TEMP TABLE tmp_excel ON COMMIT DROP AS
    SELECT DISTINCT
        COALESCE(payload->>v_col_codigo, '') AS codigo_excel,
        COALESCE(payload->>v_col_marca, '') AS marca_excel,
        COALESCE(payload->>v_col_modelo, '') AS modelo_excel,
        COALESCE(payload->>v_col_nombre, '') AS nombre_excel,
        COALESCE(payload->>v_col_moneda, v_moneda_default) AS moneda_excel,
        payload
    FROM listas_precios_raw
    WHERE importacion_id = p_importacion_id;

    -- =================================================================================
    -- OLA 1: EXACTO POR UPC (NIVEL 1)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 1, 100, true, false,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    INNER JOIN articulos a 
        ON lower(unaccent(trim(a.codigo_universal))) = lower(unaccent(trim(e.codigo_excel)))
        AND lower(unaccent(trim(a.marca))) = lower(unaccent(trim(e.marca_excel)))
        AND lower(unaccent(trim(a.modelo))) = lower(unaccent(trim(e.modelo_excel)))
    WHERE e.codigo_excel != '' AND e.marca_excel != '' AND e.modelo_excel != '' AND a.activo = true
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 2: EXACTO POR MARCA Y MODELO (NIVEL 2)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 2, 80, false, false,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    INNER JOIN articulos a 
        ON lower(unaccent(trim(a.marca))) = lower(unaccent(trim(e.marca_excel)))
        AND lower(unaccent(trim(a.modelo))) = lower(unaccent(trim(e.modelo_excel)))
    WHERE e.marca_excel != '' AND e.modelo_excel != '' AND a.activo = true
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 3: FUZZY MATCH (NIVEL 3) - Sólo el residuo!
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 3, fuzzy.pct, false, false,
        fuzzy.articulo_id, fuzzy.marca, fuzzy.modelo, fuzzy.codigo_universal, fuzzy.nombre,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    CROSS JOIN LATERAL (
        SELECT 
            a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
            round((similarity(
                lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
                lower(unaccent(trim(e.marca_excel))) || ' ' || lower(unaccent(trim(e.modelo_excel)))
            ) * 100)::numeric, 1) as pct
        FROM articulos a
        WHERE a.activo = true
          AND md.cand_articulo_id IS NULL
          AND (e.marca_excel != '' OR e.modelo_excel != '')
          AND similarity(
              lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
              lower(unaccent(trim(e.marca_excel))) || ' ' || lower(unaccent(trim(e.modelo_excel)))
          ) >= 0.55
        ORDER BY similarity(
              lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
              lower(unaccent(trim(e.marca_excel))) || ' ' || lower(unaccent(trim(e.modelo_excel)))
        ) DESC
        LIMIT 1
    ) fuzzy
    WHERE md.cand_articulo_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 4: SIN MATCH (NIVEL 4) - El resto absoluto
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 4, 0, false, false,
        NULL, NULL, NULL, NULL, NULL,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE md.importacion_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- POBLAR COSTOS ARTICULO (Para la UI)
    -- =================================================================================
    WITH precios_expandidos AS (
        SELECT 
            e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel, e.moneda_excel,
            p->>'tipo_costo' AS tipo_costo,
            NULLIF(regexp_replace(e.payload->>(p->>'columna'), '[^0-9.]', '', 'g'), '')::numeric AS valor,
            COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva
        FROM tmp_excel e,
             jsonb_array_elements(v_mapeo->'precios') AS p
    )
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT 
        p_importacion_id,
        NULL, -- El ID final solo se asigna tras confirmación
        md.cand_articulo_id,
        pe.modelo_excel, pe.marca_excel, pe.codigo_excel, pe.nombre_excel, pe.nombre_excel,
        pe.tipo_costo, pe.valor, pe.moneda_excel, 'excel', 
        COALESCE(md.pct, 0), 
        CASE 
           WHEN md.nivel = 1 THEN 'match_exacto'
           WHEN md.nivel IN (2, 3) THEN 'match_similitud'
           ELSE 'sin_match'
        END, 
        false, pe.incluye_iva
    FROM precios_expandidos pe
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = pe.codigo_excel 
        AND md.marca_excel = pe.marca_excel 
        AND md.modelo_excel = pe.modelo_excel
    WHERE pe.valor >= 0
      AND NOT EXISTS (
          SELECT 1 FROM costos_articulo ca 
          WHERE ca.importacion_id = p_importacion_id
            AND ca.tipo_costo = pe.tipo_costo
            AND ca.modelo_excel = pe.modelo_excel
            AND ca.marca_excel = pe.marca_excel
            AND ca.valor = pe.valor
      );

    -- Validación post-ejecución
    SELECT COUNT(*) INTO v_raws_count FROM tmp_excel;
    SELECT COUNT(*) INTO v_decisiones_count FROM matching_decisiones WHERE importacion_id = p_importacion_id;
    IF v_raws_count != v_decisiones_count THEN
        RAISE WARNING 'Cobertura incompleta: % raws vs % decisiones para %', v_raws_count, v_decisiones_count, p_importacion_id;
    END IF;

    -- Deshabilitar el viejo trigger que lo hacía de la vista lenta (idempotencia)
    DROP TRIGGER IF EXISTS trg_poblar_matching_decisiones ON importaciones_excel;

    -- Finalizar la auditoría actualizando el progreso y estado
    IF v_job_id IS NOT NULL THEN
        UPDATE matching_jobs SET estado = 'completado', progreso = v_total_filas, finalizado_el = now() WHERE id = v_job_id;
    END IF;

    UPDATE importaciones_excel SET estado = 'matching_completo', ultima_actividad = now() WHERE id = p_importacion_id;
    INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
    VALUES (p_importacion_id, 'MATCHING_COMPLETO', 'Matching Set-Based concluido.');

END;
$$;

-- =================================================================================
-- RPC Rápido para Frontend Stats
-- =================================================================================
CREATE OR REPLACE FUNCTION public.fn_resumen_matching(p_importacion_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'sin_match', COALESCE(SUM(CASE WHEN nivel = 4 THEN 1 ELSE 0 END), 0),
    'sugerido', COALESCE(SUM(CASE WHEN nivel IN (1, 2, 3) AND confirmado = false THEN 1 ELSE 0 END), 0),
    'confirmado', COALESCE(SUM(CASE WHEN confirmado = true THEN 1 ELSE 0 END), 0),
    'rechazado', 0,
    'total', COUNT(*)
  )
  FROM matching_decisiones
  WHERE importacion_id = p_importacion_id;
$$;

COMMIT;
