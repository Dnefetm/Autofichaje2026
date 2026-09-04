-- =============================================================================
-- MIGRACIÓN (append-only) Capa 0 — parte 2: clasificación de vinculación en SQL
-- =============================================================================
-- Sustituye la clasificación en memoria de vinculacion/page.tsx (que carga
-- 15k filas + 8k artículos y cruza en Node) por una función SQL set-based con
-- paginación. Devuelve SOLO la página pedida, no toda la lista.
--
-- LÓGICA REPRODUCIDA (idéntica a la actual de vinculacion/page.tsx):
--   ya_vinculado : alias locked coincide por código o por marca+modelo
--   triple       : EAN coincide Y marca Y modelo coinciden
--   solo_codigo  : EAN coincide pero marca/modelo difieren
--   marca_modelo : no hay EAN, pero marca+modelo (o solo modelo) coincide
--   sin_match    : nada coincide
--
-- IMPORTANTE: antes de cambiar el frontend a esta función, validar que su salida
-- coincide con la pantalla actual (dry-run de comparación). No rompe nada por sí
-- sola: es una función nueva; la pantalla actual sigue igual hasta que se cambie.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_vinculacion_clasificar(
    p_importacion_id uuid,
    p_proveedor text,
    p_categoria text,             -- 'ya_vinculado' | 'triple' | 'solo_codigo' | 'marca_modelo' | 'sin_match'
    p_limit int DEFAULT 100,
    p_offset int DEFAULT 0
)
RETURNS TABLE (
    fila_num int,
    sku_proveedor text,
    codigo_barra text,
    marca_proveedor text,
    descripcion_proveedor text,
    dist numeric,
    menudeo numeric,
    articulo_id text,
    nombre_catalogo text,
    marca_catalogo text,
    modelo_catalogo text,
    codigo_universal text
)
LANGUAGE sql
STABLE
AS $$
    WITH raw AS (
        SELECT
            r.fila_num,
            COALESCE(NULLIF(trim(r.payload->>'CLAVE'), ''), NULLIF(trim(r.payload->>'CÓDIGO'), ''), '') AS clave,
            NULLIF(trim(r.payload->>'CÓDIGO DE BARRA SIN CERO'), '') AS codigo_barra,
            COALESCE(NULLIF(trim(r.payload->>'MARCA'), ''), '') AS marca,
            COALESCE(NULLIF(trim(r.payload->>'DESCRIPCIÓN LARGA'), ''), NULLIF(trim(r.payload->>'DESCRIPCION'), ''), '') AS descripcion,
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
            r.fila_num, r.clave, r.codigo_barra, r.marca, r.descripcion, r.dist, r.menudeo,
            COALESCE(a_lock_cod.articulo_id, a_lock_mod.articulo_id) AS alias_art_id,
            a_cod.articulo_id AS cod_art_id,
            COALESCE(a_mod_mm.articulo_id, a_mod_solo.articulo_id) AS mod_art_id,
            CASE
                WHEN COALESCE(a_lock_cod.articulo_id, a_lock_mod.articulo_id) IS NOT NULL THEN 'ya_vinculado'
                WHEN a_cod.articulo_id IS NOT NULL AND lower(a_cod.marca) = lower(r.marca)
                     AND lower(a_cod.modelo) = lower(r.clave) THEN 'triple'
                WHEN a_cod.articulo_id IS NOT NULL THEN 'solo_codigo'
                WHEN COALESCE(a_mod_mm.articulo_id, a_mod_solo.articulo_id) IS NOT NULL THEN 'marca_modelo'
                ELSE 'sin_match'
            END AS categoria
        FROM raw r
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
            c.clave AS sku_proveedor,
            c.codigo_barra,
            c.marca AS marca_proveedor,
            c.descripcion AS descripcion_proveedor,
            c.dist, c.menudeo,
            COALESCE(c.alias_art_id, c.cod_art_id, c.mod_art_id) AS articulo_id,
            COALESCE(al.nombre, c_al.nombre, m_al.nombre) AS nombre_catalogo,
            COALESCE(al.marca, c_al.marca, m_al.marca) AS marca_catalogo,
            COALESCE(al.modelo, c_al.modelo, m_al.modelo) AS modelo_catalogo,
            COALESCE(al.codigo_universal, c_al.codigo_universal, m_al.codigo_universal) AS codigo_universal
        FROM clasif c
        LEFT JOIN articulos al ON al.articulo_id = c.alias_art_id
        LEFT JOIN articulos c_al ON c_al.articulo_id = c.cod_art_id
        LEFT JOIN articulos m_al ON m_al.articulo_id = c.mod_art_id
        WHERE c.categoria = p_categoria
        ORDER BY c.fila_num
        LIMIT p_limit OFFSET p_offset
    )
    SELECT * FROM final;
$$;

-- Función de conteo por categoría (para totales y paginación)
CREATE OR REPLACE FUNCTION public.fn_vinculacion_conteo(
    p_importacion_id uuid,
    p_proveedor text
)
RETURNS TABLE (categoria text, total bigint)
LANGUAGE sql
STABLE
AS $$
    WITH raw AS (
        SELECT
            r.fila_num,
            COALESCE(NULLIF(trim(r.payload->>'CLAVE'), ''), NULLIF(trim(r.payload->>'CÓDIGO'), ''), '') AS clave,
            NULLIF(trim(r.payload->>'CÓDIGO DE BARRA SIN CERO'), '') AS codigo_barra,
            COALESCE(NULLIF(trim(r.payload->>'MARCA'), ''), '') AS marca
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
            CASE
                WHEN COALESCE(a_lock_cod.articulo_id, a_lock_mod.articulo_id) IS NOT NULL THEN 'ya_vinculado'
                WHEN a_cod.articulo_id IS NOT NULL AND lower(a_cod.marca) = lower(r.marca)
                     AND lower(a_cod.modelo) = lower(r.clave) THEN 'triple'
                WHEN a_cod.articulo_id IS NOT NULL THEN 'solo_codigo'
                WHEN COALESCE(a_mod_mm.articulo_id, a_mod_solo.articulo_id) IS NOT NULL THEN 'marca_modelo'
                ELSE 'sin_match'
            END AS categoria
        FROM raw r
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
        LEFT JOIN articulos a_mod_mm
            ON a_mod_mm.activo = true
            AND lower(a_mod_mm.marca) = lower(r.marca)
            AND lower(a_mod_mm.modelo) = lower(r.clave)
        LEFT JOIN articulos a_mod_solo
            ON a_mod_solo.activo = true
            AND a_mod_solo.modelo IS NOT NULL
            AND lower(a_mod_solo.modelo) = lower(r.clave)
        ORDER BY r.fila_num
    )
    SELECT categoria, count(*)::bigint AS total
    FROM clasif
    GROUP BY categoria;
$$;

COMMIT;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.fn_vinculacion_clasificar(uuid, text, text, int, int);
-- DROP FUNCTION IF EXISTS public.fn_vinculacion_conteo(uuid, text);
