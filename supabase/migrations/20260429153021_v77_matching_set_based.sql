-- =============================================================================
-- MIGRACIÓN v77: Refactorización a Matching Set-Based en Postgres
-- Elimina la dependencia de Edge Functions, procesa en 3 olas (exacto, modelo, fuzzy)
-- =============================================================================

BEGIN;

-- 1. Eliminar cron y trigger antiguos
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'watchdog-matching') THEN
    PERFORM cron.unschedule('watchdog-matching');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_matching_jobs_pendiente ON matching_jobs;
DROP FUNCTION IF EXISTS public.fn_trigger_procesar_matching();

-- 2. Asegurarse de que la tabla matching_decisiones tiene la llave única necesaria para idempotencia
-- Asumimos que la tabla existe y ya fue creada previamente, si no, se agrega la restricción:
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_matching_decisiones_raw'
    ) THEN
        ALTER TABLE matching_decisiones ADD CONSTRAINT uq_matching_decisiones_raw UNIQUE (importacion_id, codigo_universal_excel, marca_excel, modelo_excel);
    END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. Crear RPC fn_match_precios_v2
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
    v_proveedor text;
    v_job_id uuid;
BEGIN
    -- Registrar inicio de la operación
    SELECT id INTO v_job_id FROM matching_jobs WHERE importacion_id = p_importacion_id LIMIT 1;
    IF v_job_id IS NOT NULL THEN
        UPDATE matching_jobs SET estado = 'corriendo', iniciado_el = now() WHERE id = v_job_id;
    END IF;

    -- Obtener la importación
    SELECT mapeo_columnas, proveedor INTO v_mapeo, v_proveedor
    FROM importaciones_excel 
    WHERE id = p_importacion_id;

    v_col_modelo := v_mapeo->>'columna_modelo';
    v_col_marca := v_mapeo->>'columna_marca';
    v_col_codigo := v_mapeo->>'columna_codigo';
    v_col_nombre := v_mapeo->>'columna_descripcion';

    -- Crear una vista materializada temporal del excel deduplicada para agilizar (idempotente)
    CREATE TEMP TABLE tmp_excel ON COMMIT DROP AS
    SELECT DISTINCT
        COALESCE(payload->>v_col_codigo, '') AS codigo_excel,
        COALESCE(payload->>v_col_marca, '') AS marca_excel,
        COALESCE(payload->>v_col_modelo, '') AS modelo_excel,
        COALESCE(payload->>v_col_nombre, '') AS nombre_excel
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
    SELECT 
        p_importacion_id, 1, 100, true, true,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        a.articulo_id, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    INNER JOIN articulos a ON lower(unaccent(trim(a.codigo_universal))) = lower(unaccent(trim(e.codigo_excel)))
    WHERE e.codigo_excel != '' AND a.activo = true
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 2: EXACTO POR MARCA Y MODELO (NIVEL 2)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT 
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
    -- Usamos un subquery con LATERAL para obtener solo el mejor match del residuo
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT 
        p_importacion_id, 3, fuzzy.pct, false, false,
        fuzzy.articulo_id, fuzzy.marca, fuzzy.modelo, fuzzy.codigo_universal, fuzzy.nombre,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    -- Solo procesamos los que no tienen decisión previa
    CROSS JOIN LATERAL (
        SELECT 
            a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
            round((similarity(
                lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
                lower(unaccent(trim(e.marca_excel))) || ' ' || lower(unaccent(trim(e.modelo_excel)))
            ) * 100)::numeric, 1) as pct
        FROM articulos a
        WHERE a.activo = true
          AND md.cand_articulo_id IS NULL -- Si MD ya existe, esto asegura que el LATERAL sea vacio
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
    WHERE md.cand_articulo_id IS NULL -- Filtra los que ya hicieron match en ola 1 o 2
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- Deshabilitar el viejo trigger que lo hacía de la vista lenta
    DROP TRIGGER IF EXISTS trg_poblar_matching_decisiones ON importaciones_excel;

    -- Finalizar la auditoría
    IF v_job_id IS NOT NULL THEN
        UPDATE matching_jobs SET estado = 'completado', finalizado_el = now() WHERE id = v_job_id;
    END IF;

    UPDATE importaciones_excel SET estado = 'matching_completo', ultima_actividad = now() WHERE id = p_importacion_id;

    INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
    VALUES (p_importacion_id, 'MATCHING_COMPLETO', 'Matching Set-Based concluido.');

END;
$$;

COMMIT;
