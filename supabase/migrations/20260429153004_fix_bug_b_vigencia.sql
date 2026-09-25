BEGIN;

-- 1. Create the modified function definition
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
    v_matches_count int;
BEGIN
    SELECT mapeo_columnas, proveedor, total_filas INTO v_mapeo, v_proveedor, v_total_filas
    FROM importaciones_excel 
    WHERE id = p_importacion_id;

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
    SELECT DISTINCT
        COALESCE(payload->>v_col_codigo, '') AS codigo_excel,
        COALESCE(payload->>v_col_marca, '') AS marca_excel,
        COALESCE(payload->>v_col_modelo, '') AS modelo_excel,
        COALESCE(payload->>v_col_nombre, '') AS nombre_excel,
        COALESCE(payload->>v_col_moneda, v_moneda_default) AS moneda_excel,
        payload
    FROM listas_precios_raw
    WHERE importacion_id = p_importacion_id;

    UPDATE tmp_excel SET codigo_excel = regexp_replace(codigo_excel, '[^0-9A-Za-z]', '', 'g') WHERE codigo_excel <> '';

    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 0, 100, true, 
        CASE WHEN alias.ultima_vez_visto > now() - interval '180 days' THEN true ELSE false END,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        CASE WHEN alias.ultima_vez_visto > now() - interval '180 days' THEN a.articulo_id ELSE NULL END, 
        v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    JOIN proveedor_articulos_alias alias 
        ON alias.proveedor = v_proveedor
       AND alias.codigo_excel = e.codigo_excel 
       AND alias.marca_excel = e.marca_excel 
       AND alias.modelo_excel = e.modelo_excel
       AND e.codigo_excel <> ''
    JOIN articulos a ON a.articulo_id = alias.articulo_id AND a.activo = true
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 0, 100, true, 
        CASE WHEN alias.ultima_vez_visto > now() - interval '180 days' THEN true ELSE false END,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        CASE WHEN alias.ultima_vez_visto > now() - interval '180 days' THEN a.articulo_id ELSE NULL END, 
        v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    JOIN proveedor_articulos_alias alias 
        ON alias.proveedor = v_proveedor
       AND alias.marca_excel = e.marca_excel 
       AND alias.modelo_excel = e.modelo_excel
    JOIN articulos a ON a.articulo_id = alias.articulo_id AND a.activo = true
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE md.cand_articulo_id IS NULL 
      AND (e.marca_excel <> '' OR e.modelo_excel <> '')
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

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
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE e.codigo_excel != '' AND e.marca_excel != '' AND e.modelo_excel != '' AND a.activo = true
      AND md.cand_articulo_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 2, 95, true, false,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    INNER JOIN articulos a ON lower(unaccent(trim(a.codigo_universal))) = lower(unaccent(trim(e.codigo_excel)))
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE e.codigo_excel != '' AND a.activo = true AND md.cand_articulo_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 3, 80, false, false,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    INNER JOIN articulos a 
        ON lower(unaccent(trim(a.marca))) = lower(unaccent(trim(e.marca_excel)))
        AND lower(unaccent(trim(a.modelo))) = lower(unaccent(trim(e.modelo_excel)))
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE e.marca_excel != '' AND e.modelo_excel != '' AND a.activo = true AND md.cand_articulo_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 4, fuzzy.pct, false, false,
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

    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 5, 0, false, false,
        NULL, NULL, NULL, NULL, NULL,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE md.importacion_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

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
        md.articulo_id_final,
        md.cand_articulo_id,
        pe.modelo_excel, pe.marca_excel, pe.codigo_excel, pe.nombre_excel, pe.nombre_excel,
        pe.tipo_costo, pe.valor, pe.moneda_excel, 'excel', 
        COALESCE(md.pct, 0), 
        CASE 
           WHEN md.nivel = 0 THEN 'completado'
           WHEN md.nivel = 1 THEN 'match_exacto'
           WHEN md.nivel IN (2, 3, 4) THEN 'match_similitud'
           ELSE 'sin_match'
        END, 
        CASE WHEN md.nivel = 0 AND md.confirmado = true THEN true ELSE false END, 
        pe.incluye_iva
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

    UPDATE proveedor_articulos_alias
    SET estado_proveedor = 'descontinuado'
    WHERE proveedor = v_proveedor
      AND ultima_vez_visto < (now() - interval '1 day');

    -- FASE 0 LOGIC: Actualizar precios de lista anterior (Header Vigencia)
    -- Contar matches reales (nivel < 5 significa que al menos sugirió algo o matcheó algo)
    SELECT COUNT(*) INTO v_matches_count FROM matching_decisiones WHERE importacion_id = p_importacion_id AND nivel < 5;
    
    -- Solo marcar como vigente si hubo al menos un match (Bug B)
    IF v_matches_count > 0 THEN
        UPDATE public.listas_precios_proveedor
           SET vigente = false, fecha_vigor_hasta = CURRENT_DATE
         WHERE proveedor = v_proveedor
           AND vigente = true
           AND importacion_id <> p_importacion_id;

        UPDATE public.listas_precios_proveedor
           SET vigente = true
         WHERE importacion_id = p_importacion_id;
    END IF;

    SELECT COUNT(*) INTO v_raws_count FROM tmp_excel;
    SELECT COUNT(*) INTO v_decisiones_count FROM matching_decisiones WHERE importacion_id = p_importacion_id;

    IF v_job_id IS NOT NULL THEN
        UPDATE matching_jobs SET estado = 'completado', progreso = v_total_filas, finalizado_el = now() WHERE id = v_job_id;
    END IF;

    -- Si hubo cero matches, dejarlo en revisión pero añadir aviso en los eventos
    UPDATE importaciones_excel SET estado = 'matching_completo', ultima_actividad = now() WHERE id = p_importacion_id;
    
    IF v_matches_count > 0 THEN
        INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
        VALUES (p_importacion_id, 'MATCHING_COMPLETO', 'Matching Set-Based con Ola 0 y Fase 0 concluido. Lista marcada como vigente.');
    ELSE
        INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
        VALUES (p_importacion_id, 'MATCHING_COMPLETO', 'Matching concluido con 0 coincidencias. No se actualizó la lista vigente.');
    END IF;

END;
$$;

COMMIT;
