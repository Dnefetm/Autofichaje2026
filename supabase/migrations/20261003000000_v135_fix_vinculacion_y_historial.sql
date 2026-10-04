-- =============================================================================
-- v135: arreglar vinculación (lee lista activa) y columna "vigente" del historial
-- =============================================================================
-- 1) v_importaciones_historial: añade columna `vigente` (antes inexistente),
--    por eso el Historial siempre pintaba "Vigente: No" (undefined).
-- 2) fn_materializar_vinculacion: quita el filtro `pp.vigente = true`, para que
--    lea por importacion_id (la lista activa) sin depender del flag interno
--    precios_proveedor.vigente (= "última procesada", semántica distinta).
-- Idempotente (CREATE OR REPLACE). No borra datos.
-- =============================================================================

-- ---------------------------------------------------------------
-- 1) Vista de historial con columna `vigente`
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_importaciones_historial AS
SELECT
  ie.id,
  ie.proveedor,
  ie.nombre_archivo,
  ie.total_filas,
  ie.filas_con_match,
  ie.estado,
  ie.creado_el,
  ie.tipo_costo_default,
  (SELECT count(*) AS count
   FROM public.listas_precios_raw lpr
   WHERE lpr.importacion_id = ie.id AND lpr.revertido_at IS NULL) AS filas_raw_activas,
  (SELECT count(*) AS count
   FROM public.costos_articulo ca
   WHERE ca.importacion_id = ie.id AND ca.vigente) AS costos_vigentes_generados,
  COALESCE((
    SELECT lpp.vigente
    FROM public.listas_precios_proveedor lpp
    WHERE lpp.importacion_id = ie.id
    LIMIT 1
  ), false) AS vigente
FROM public.importaciones_excel ie
ORDER BY ie.creado_el DESC;

-- ---------------------------------------------------------------
-- 2) fn_materializar_vinculacion sin filtro vigente=true
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_materializar_vinculacion(p_importacion_id uuid, p_proveedor text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    DELETE FROM vinculacion_clasificada WHERE importacion_id = p_importacion_id;

    WITH raw AS (
        SELECT
            pp.sku_proveedor AS clave,
            MAX(pp.fila_num) AS fila_num,
            MAX(NULLIF(trim(pp.codigo_barra), '')) AS codigo_barra,
            COALESCE(MAX(pp.marca), '') AS marca,
            COALESCE(MAX(pp.descripcion), '') AS descripcion,
            COALESCE(MAX(pp.valor) FILTER (WHERE lower(trim(pp.tipo_costo)) = 'distribuidor'), 0)::numeric AS dist,
            COALESCE(MAX(pp.valor) FILTER (WHERE lower(trim(pp.tipo_costo)) = 'menudeo'), 0)::numeric AS menudeo
        FROM public.precios_proveedor pp
        WHERE pp.importacion_id = p_importacion_id
        GROUP BY pp.sku_proveedor
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
