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
    SELECT DISTINCT
        COALESCE(payload->>v_col_codigo, '') AS codigo_excel,
        COALESCE(payload->>v_col_marca, '') AS marca_excel,
        COALESCE(payload->>v_col_modelo, '') AS modelo_excel,
        COALESCE(payload->>v_col_nombre, '') AS nombre_excel,
        COALESCE(payload->>v_col_moneda, v_moneda_default) AS moneda_excel,
        payload
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
            p->>'tipo_costo' AS tipo_costo,
            fn_parse_precio(t.payload->>(p->>'columna')) AS valor,
            COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva
        FROM tmp_resolucion t,
             jsonb_array_elements(v_mapeo->'precios') AS p
    )
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT 
        p_importacion_id,
        pe.articulo_id_resuelto,
        pe.articulo_id_resuelto,
        pe.modelo_excel, pe.marca_excel, pe.codigo_excel, pe.nombre_excel, pe.nombre_excel,
        pe.tipo_costo, pe.valor, pe.moneda_excel, 'excel', 
        100, 
        'completado', 
        true, 
        pe.incluye_iva
    FROM precios_expandidos pe
    WHERE pe.valor IS NOT NULL AND pe.articulo_id_resuelto IS NOT NULL
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
            p->>'tipo_costo' AS tipo_costo,
            fn_parse_precio(t.payload->>(p->>'columna')) AS valor
        FROM tmp_resolucion t,
             jsonb_array_elements(v_mapeo->'precios') AS p
    )
    INSERT INTO costos_pendientes (
        importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel, tipo_costo, moneda, valor, motivo
    )
    SELECT 
        p_importacion_id, v_proveedor, pe.codigo_excel, pe.marca_excel, pe.modelo_excel, pe.tipo_costo, pe.moneda_excel, pe.valor,
        'sin_match'
    FROM precios_expandidos pe
    WHERE pe.valor IS NOT NULL AND pe.articulo_id_resuelto IS NULL
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
