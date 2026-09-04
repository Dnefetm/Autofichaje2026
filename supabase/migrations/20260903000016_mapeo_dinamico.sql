-- =============================================================================
-- MIGRACIÓN (append-only) Capa 0 — parte 8: mapeo dinámico en materialización
-- =============================================================================
-- fn_materializar_vinculacion lee las columnas reales desde
-- importaciones_excel.mapeo_columnas (columna_modelo, columna_codigo,
-- columna_marca, columna_descripcion) en vez de tener CLAVE/CÓDIGO hardcodeados.
-- Así respeta lo que el operador seleccionó en "Mapear Columnas".
--
-- Además, para el lote vigente de Urrea, se fija columna_modelo = 'CÓDIGO'
-- (la columna A), que es la que coincide con articulos.modelo (ej. 144023),
-- en lugar de CLAVE (columna C, ej. SET-85).
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_materializar_vinculacion(p_importacion_id uuid, p_proveedor text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_col_modelo      text := 'CLAVE';
    v_col_codigo      text := 'CÓDIGO DE BARRA SIN CERO';
    v_col_marca       text := 'MARCA';
    v_col_descripcion text := 'DESCRIPCIÓN LARGA';
BEGIN
    -- Lee el mapeo real del lote (la UI lo guardó en mapeo_columnas).
    SELECT
        COALESCE(NULLIF(mapeo_columnas->>'columna_modelo', ''), 'CLAVE'),
        COALESCE(NULLIF(mapeo_columnas->>'columna_codigo', ''), 'CÓDIGO DE BARRA SIN CERO'),
        COALESCE(NULLIF(mapeo_columnas->>'columna_marca', ''), 'MARCA'),
        COALESCE(NULLIF(mapeo_columnas->>'columna_descripcion', ''), 'DESCRIPCIÓN LARGA')
    INTO v_col_modelo, v_col_codigo, v_col_marca, v_col_descripcion
    FROM importaciones_excel
    WHERE id = p_importacion_id;

    DELETE FROM vinculacion_clasificada WHERE importacion_id = p_importacion_id;

    WITH raw AS (
        SELECT
            r.fila_num,
            COALESCE(NULLIF(trim(r.payload->>v_col_modelo), ''), '') AS clave,
            NULLIF(trim(r.payload->>v_col_codigo), '') AS codigo_barra,
            COALESCE(NULLIF(trim(r.payload->>v_col_marca), ''), '') AS marca,
            COALESCE(NULLIF(trim(r.payload->>v_col_descripcion), ''), '') AS descripcion,
            COALESCE(NULLIF(regexp_replace(r.payload->>'P.DIST (CON IVA)', '[^0-9.]', '', 'g'), ''), NULLIF(regexp_replace(r.payload->>'P.DIST', '[^0-9.]', '', 'g'), ''), '0')::numeric AS dist,
            COALESCE(NULLIF(regexp_replace(r.payload->>'PRECIO MENUDEO (CON IVA)', '[^0-9.]', '', 'g'), ''), '0')::numeric AS menudeo
        FROM listas_precios_raw r
        WHERE r.importacion_id = p_importacion_id
    ),
    alias_lock AS (
        SELECT codigo_excel, marca_excel, modelo_excel, articulo_id
        FROM proveedor_articulos_alias
        WHERE proveedor = p_proveedor AND locked = true
    ),
    clasif AS (
        SELECT DISTINCT ON (r.fila_num)
            r.fila_num,
            r.clave, r.codigo_barra, r.marca, r.descripcion, r.dist, r.menudeo,
            COALESCE(a_lock_cod.articulo_id, a_lock_mod.articulo_id) AS alias_art_id,
            a_triple.articulo_id AS triple_art_id,
            a_cod.articulo_id AS cod_art_id,
            COALESCE(a_mod_mm.articulo_id, a_mod_solo.articulo_id) AS mod_art_id,
            CASE
                WHEN rej.fila_num IS NOT NULL THEN 'rechazado'
                WHEN COALESCE(a_lock_cod.articulo_id, a_lock_mod.articulo_id) IS NOT NULL THEN 'ya_vinculado'
                WHEN a_triple.articulo_id IS NOT NULL THEN 'triple'
                WHEN a_cod.articulo_id IS NOT NULL THEN 'solo_codigo'
                WHEN COALESCE(a_mod_mm.articulo_id, a_mod_solo.articulo_id) IS NOT NULL THEN 'marca_modelo'
                ELSE 'sin_match'
            END AS categoria
        FROM raw r
        LEFT JOIN vinculacion_rechazos rej
            ON rej.importacion_id = p_importacion_id AND rej.fila_num = r.fila_num
        LEFT JOIN alias_lock a_lock_cod
            ON r.codigo_barra IS NOT NULL
            AND a_lock_cod.codigo_excel IS NOT NULL AND a_lock_cod.codigo_excel <> ''
            AND lower(trim(a_lock_cod.codigo_excel)) = lower(r.codigo_barra)
        LEFT JOIN alias_lock a_lock_mod
            ON a_lock_mod.marca_excel IS NOT NULL AND a_lock_mod.modelo_excel IS NOT NULL
            AND lower(trim(a_lock_mod.marca_excel)) = lower(r.marca)
            AND lower(trim(a_lock_mod.modelo_excel)) = lower(r.clave)
        LEFT JOIN articulos a_cod
            ON a_cod.activo = true AND r.codigo_barra IS NOT NULL AND a_cod.codigo_universal = r.codigo_barra
        LEFT JOIN articulos a_triple
            ON a_triple.activo = true AND r.codigo_barra IS NOT NULL AND a_triple.codigo_universal = r.codigo_barra
            AND lower(a_triple.marca) = lower(r.marca)
            AND lower(a_triple.modelo) = lower(r.clave)
        LEFT JOIN articulos a_mod_mm
            ON a_mod_mm.activo = true
            AND lower(a_mod_mm.marca) = lower(r.marca)
            AND lower(a_mod_mm.modelo) = lower(r.clave)
        LEFT JOIN articulos a_mod_solo
            ON a_mod_solo.activo = true
            AND a_mod_solo.modelo IS NOT NULL
            AND lower(a_mod_solo.modelo) = lower(r.clave)
        ORDER BY r.fila_num
    ),
    final AS (
        SELECT
            c.fila_num,
            c.categoria,
            COALESCE(c.alias_art_id, c.triple_art_id, c.cod_art_id, c.mod_art_id) AS articulo_id,
            c.clave AS sku_proveedor,
            c.codigo_barra,
            c.marca AS marca_proveedor,
            c.descripcion AS descripcion_proveedor,
            c.dist, c.menudeo
        FROM clasif c
    )
    INSERT INTO vinculacion_clasificada (
        importacion_id, fila_num, categoria, articulo_id,
        nombre_catalogo, marca_catalogo, modelo_catalogo, codigo_universal,
        sku_proveedor, codigo_barra, marca_proveedor, descripcion_proveedor, dist, menudeo
    )
    SELECT
        p_importacion_id,
        f.fila_num, f.categoria, f.articulo_id,
        a.nombre, a.marca, a.modelo, a.codigo_universal,
        f.sku_proveedor, f.codigo_barra, f.marca_proveedor, f.descripcion_proveedor, f.dist, f.menudeo
    FROM final f
    LEFT JOIN articulos a ON a.articulo_id = f.articulo_id;
END;
$$;

-- Fija columna_modelo = 'CÓDIGO' para el lote vigente de Urrea.
UPDATE importaciones_excel
SET mapeo_columnas = jsonb_set(mapeo_columnas, '{columna_modelo}', '"CÓDIGO"'::jsonb)
WHERE id = 'f93e4c8b-4eee-4b03-8d2a-188cedae3c63';

COMMIT;

-- =============================================================================
-- DESPUÉS de aplicar, re-materializar el lote:
--   SELECT fn_materializar_vinculacion('f93e4c8b-4eee-4b03-8d2a-188cedae3c63', 'Urrea Herramientas');
-- =============================================================================

-- ROLLBACK:
-- UPDATE importaciones_excel
--   SET mapeo_columnas = jsonb_set(mapeo_columnas, '{columna_modelo}', '"CLAVE"'::jsonb)
--   WHERE id = 'f93e4c8b-4eee-4b03-8d2a-188cedae3c63';
-- (re-aplicar la versión de fn_materializar_vinculacion de 0015)
