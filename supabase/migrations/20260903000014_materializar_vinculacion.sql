-- =============================================================================
-- MIGRACIÓN (append-only) Capa 0 — parte 6: materialización de la clasificación
-- =============================================================================
-- Clasifica el lote UNA VEZ y lo guarda en una tabla indexada. El frontend paginará
-- sobre esta tabla (SELECT ... LIMIT/OFFSET) en vez de reclasificar 15k filas por
-- cada página.
--
-- CORREGIDO: la lógica reproduce EXACTAMENTE la de fn_vinculacion_clasificar
-- (0003 + fix 0013), y la info del artículo se resuelve por el articulo_id final
-- (COALESCE), no por JOINs separados por tipo de match (que dejaban NULL en
-- alias-por-modelo y en marca_modelo-por-solo-modelo).
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.vinculacion_clasificada (
    importacion_id        uuid NOT NULL,
    fila_num              int NOT NULL,
    categoria             text NOT NULL,
    articulo_id           text,
    nombre_catalogo       text,
    marca_catalogo        text,
    modelo_catalogo       text,
    codigo_universal      text,
    sku_proveedor         text,
    codigo_barra          text,
    marca_proveedor       text,
    descripcion_proveedor text,
    dist                  numeric,
    menudeo               numeric,
    PRIMARY KEY (importacion_id, fila_num)
);

CREATE INDEX IF NOT EXISTS ix_vc_categoria
    ON public.vinculacion_clasificada (importacion_id, categoria, fila_num);

CREATE OR REPLACE FUNCTION public.fn_materializar_vinculacion(p_importacion_id uuid, p_proveedor text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM vinculacion_clasificada WHERE importacion_id = p_importacion_id;

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
            r.fila_num,
            r.clave, r.codigo_barra, r.marca, r.descripcion, r.dist, r.menudeo,
            COALESCE(a_lock_cod.articulo_id, a_lock_mod.articulo_id) AS alias_art_id,
            a_triple.articulo_id AS triple_art_id,
            a_cod.articulo_id AS cod_art_id,
            COALESCE(a_mod_mm.articulo_id, a_mod_solo.articulo_id) AS mod_art_id,
            CASE
                WHEN COALESCE(a_lock_cod.articulo_id, a_lock_mod.articulo_id) IS NOT NULL THEN 'ya_vinculado'
                WHEN a_triple.articulo_id IS NOT NULL THEN 'triple'
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

COMMIT;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.fn_materializar_vinculacion(uuid, text);
-- DROP TABLE IF EXISTS public.vinculacion_clasificada;
