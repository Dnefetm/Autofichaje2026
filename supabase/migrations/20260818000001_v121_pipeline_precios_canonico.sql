-- ============================================================================
-- Migración: v121_pipeline_precios_canonico.sql
-- Propósito: Persistencia del catálogo de proveedores, cálculo de diff mensual
--            y propagación automática de costos vía proveedor_articulos_alias.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_raw_importacion_proveedor ON listas_precios_raw(importacion_id, proveedor);

CREATE OR REPLACE FUNCTION fn_marcar_lista_vigente(p_importacion_id uuid, p_proveedor text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE listas_precios_proveedor
       SET vigente = false, fecha_vigor_hasta = CURRENT_DATE
     WHERE proveedor = p_proveedor
       AND vigente = true
       AND importacion_id <> p_importacion_id;

    INSERT INTO listas_precios_proveedor (
        proveedor, importacion_id, vigente, fecha_vigor_desde, total_filas
    )
    SELECT 
        p_proveedor, p_importacion_id, true, CURRENT_DATE, count(*)::int
    FROM listas_precios_raw
    WHERE importacion_id = p_importacion_id
    ON CONFLICT DO NOTHING;

    UPDATE listas_precios_proveedor
       SET vigente = true
     WHERE importacion_id = p_importacion_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_propagar_costos_alias(p_importacion_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_proveedor text;
    v_mapeo jsonb;
    v_col_modelo text;
    v_col_codigo text;
    v_filas_actualizadas int := 0;
BEGIN
    SELECT proveedor, mapeo_columnas INTO v_proveedor, v_mapeo
    FROM importaciones_excel
    WHERE id = p_importacion_id;

    IF v_mapeo IS NULL THEN
        RETURN 0;
    END IF;

    v_col_modelo := v_mapeo->>'columna_modelo';
    v_col_codigo := v_mapeo->>'columna_codigo';

    WITH expandido AS (
        SELECT 
            r.fila_num,
            alias.articulo_id,
            COALESCE(r.payload->>v_col_modelo, '') AS modelo_excel,
            COALESCE(r.payload->>(v_mapeo->>'columna_marca'), '') AS marca_excel,
            COALESCE(r.payload->>v_col_codigo, '') AS codigo_excel,
            COALESCE(r.payload->>(v_mapeo->>'columna_descripcion'), '') AS descripcion_excel,
            p->>'tipo_costo' AS tipo_costo,
            fn_parse_precio(r.payload->>(p->>'columna')) AS valor,
            COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva,
            COALESCE(r.payload->>(v_mapeo->>'columna_moneda'), v_mapeo->>'moneda_default', 'MXN') AS moneda
        FROM listas_precios_raw r
        JOIN proveedor_articulos_alias alias 
          ON alias.proveedor = v_proveedor
         AND (
             (alias.codigo_excel <> '' AND alias.codigo_excel = r.payload->>v_col_codigo)
             OR (alias.modelo_excel <> '' AND alias.modelo_excel = r.payload->>v_col_modelo)
         )
        CROSS JOIN jsonb_array_elements(v_mapeo->'precios') AS p
        WHERE r.importacion_id = p_importacion_id
          AND alias.estado_proveedor = 'activo'
    ),
    dedup AS (
        SELECT DISTINCT ON (articulo_id, tipo_costo) *
        FROM expandido
        WHERE valor IS NOT NULL AND valor > 0
        ORDER BY articulo_id, tipo_costo, fila_num DESC
    )
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, modelo_excel, marca_excel, codigo_universal_excel,
        descripcion_excel, tipo_costo, valor, moneda, fuente, puntaje_match,
        estado_match, vigente, incluye_iva, actualizado_el
    )
    SELECT 
        p_importacion_id, d.articulo_id, d.modelo_excel, d.marca_excel, d.codigo_excel,
        d.descripcion_excel, d.tipo_costo, d.valor, d.moneda, 'excel', 100,
        'match_exacto', true, d.incluye_iva, now()
    FROM dedup d
    ON CONFLICT (articulo_id, tipo_costo, fuente)
    DO UPDATE SET 
        valor = EXCLUDED.valor,
        moneda = EXCLUDED.moneda,
        importacion_id = EXCLUDED.importacion_id,
        vigente = EXCLUDED.vigente,
        incluye_iva = EXCLUDED.incluye_iva,
        actualizado_el = now();

    GET DIAGNOSTICS v_filas_actualizadas = ROW_COUNT;
    RETURN v_filas_actualizadas;
END;
$$;
