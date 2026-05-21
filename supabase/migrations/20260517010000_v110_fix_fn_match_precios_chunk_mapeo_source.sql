-- =============================================================================
-- MIGRACIÓN v110: Corrección de origen de mapeo_columnas en chunk matcher
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_match_precios_chunk(
    p_importacion_id uuid,
    p_offset integer,
    p_limit integer
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_procesadas integer := 0;
    v_mapeo jsonb;
    v_proveedor text;
    v_col_modelo text;
    v_col_marca text;
    v_col_codigo text;
    v_col_desc text;
    v_col_moneda text;
    v_moneda_default text;
BEGIN
    -- Leer mapeo dinámico de la importación y el proveedor
    SELECT mapeo_columnas, proveedor
    INTO v_mapeo, v_proveedor
    FROM public.importaciones_excel 
    WHERE id = p_importacion_id;
    
    IF v_mapeo IS NULL THEN
       RETURN 0;
    END IF;

    v_col_modelo := v_mapeo->>'columna_modelo';
    v_col_marca := v_mapeo->>'columna_marca';
    v_col_codigo := v_mapeo->>'columna_codigo';
    v_col_desc := v_mapeo->>'columna_descripcion';
    v_col_moneda := v_mapeo->>'columna_moneda';
    v_moneda_default := COALESCE(v_mapeo->>'moneda_default', 'MXN');

    WITH chunk AS (
        SELECT id AS staging_id, importacion_id, fila_num, payload 
        FROM listas_precios_raw 
        WHERE importacion_id = p_importacion_id
        ORDER BY fila_num
        LIMIT p_limit OFFSET p_offset
    ),
    candidatos AS (
        SELECT 
            c.staging_id,
            c.importacion_id,
            c.payload,
            COALESCE(c.payload->>v_col_modelo, '') AS val_modelo,
            COALESCE(c.payload->>v_col_marca, '') AS val_marca,
            COALESCE(c.payload->>v_col_codigo, '') AS val_codigo,
            COALESCE(c.payload->>v_col_desc, '') AS val_desc,
            COALESCE(c.payload->>v_col_moneda, v_moneda_default) AS val_moneda,
            match.articulo_id AS articulo_sugerido_id,
            match.puntaje_match,
            match.nivel_match,
            -- Calcular estado_match igual que en JS original
            CASE 
               WHEN match.nivel_match IN ('actualizado_fuerte', 'match_exacto') THEN 'match_exacto'
               WHEN match.nivel_match IN ('cambio_codigo_sugerido', 'ambiguo', 'match_similitud') THEN 'match_similitud'
               ELSE 'sin_match'
            END AS calc_estado_match
        FROM chunk c
        LEFT JOIN LATERAL (
             SELECT * FROM fn_match_articulo_proveedor(
                (c.payload->>v_col_modelo), 
                (c.payload->>v_col_marca), 
                (c.payload->>v_col_codigo)
             ) LIMIT 1
        ) match ON true
    ),
    -- Expandir los precios configurados en el mapeo (array)
    precios_expandidos AS (
        SELECT 
            c.*,
            p->>'tipo_costo' AS tipo_costo,
            NULLIF(regexp_replace(c.payload->>(p->>'columna'), '[^0-9.]', '', 'g'), '')::numeric AS valor,
            COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva
        FROM candidatos c,
             jsonb_array_elements(v_mapeo->'precios') AS p
    )
    -- Inserción final con ON CONFLICT DO NOTHING para idempotencia
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT 
        pe.importacion_id,
        NULL, -- articulo_id (se confirma después)
        pe.articulo_sugerido_id,
        pe.val_modelo, pe.val_marca, pe.val_codigo, pe.val_desc, pe.val_desc,
        pe.tipo_costo, pe.valor, pe.val_moneda, v_proveedor, pe.puntaje_match, pe.calc_estado_match, false, pe.incluye_iva
    FROM precios_expandidos pe
    WHERE pe.valor >= 0
      -- Check de idempotencia heurística
      AND NOT EXISTS (
          SELECT 1 FROM costos_articulo ca 
          WHERE ca.importacion_id = pe.importacion_id
            AND ca.tipo_costo = pe.tipo_costo
            AND ca.modelo_excel = pe.val_modelo
            AND ca.marca_excel = pe.val_marca
            AND ca.valor = pe.valor
      );
      
    GET DIAGNOSTICS v_procesadas = ROW_COUNT;
    
    RETURN v_procesadas;
END;
$$;

COMMIT;
