-- =============================================================================
-- MIGRACIÓN (append-only): revierte 0008 — restaura fn_vinculacion_conteo fijo
-- =============================================================================
-- El cambio a mapeo_columnas (0008) introdujo una regresión (triple 20->19,
-- solo_codigo 625->626) porque la pantalla usa CLAVE||CÓDIGO y el mapeo solo
-- guarda CLAVE. Se restaura la versión con columnas fijas (correcta para Urrea).
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_vinculacion_conteo(p_importacion_id uuid, p_proveedor text)
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

-- ROLLBACK: re-aplicar 0008 (mapeo_columnas) si se quiere.
