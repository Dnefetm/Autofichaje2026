-- 20261027: Score unificado multicampo en la cola de mapeo pendiente (v2, corrige 5 bugs).
-- v2: (1) suma SKU+Código por (pub_id, articulo_id), (2) DROP FUNCTION previo,
--     (3) LEFT JOIN desde pendientes (no oculta sin-match), (4) translate() en vez de unaccent(),
--     (5) cubre articulo_id + alias de proveedor + hermanas de catálogo.

DROP FUNCTION IF EXISTS public.fn_cola_mapeo_pendientes(text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.fn_cola_mapeo_pendientes(
  p_search text DEFAULT '',
  p_order_by text DEFAULT 'visits_30d',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  pub_id uuid,
  total_count bigint,
  sug_score integer,
  sug_metodo text,
  sug_motivo text,
  art_id text,
  art_nombre text,
  art_marca text,
  art_modelo text,
  art_variante text,
  art_codigo_universal text,
  art_caja_madre text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  WITH pendientes AS MATERIALIZED (
    SELECT
      pe.id,
      lower(btrim(COALESCE(pe.titulo, ''))) AS titulo_norm,
      translate(lower(btrim(COALESCE(pe.brand, ''))), 'áéíóúü', 'aeiouu') AS brand_key,
      lower(btrim(COALESCE(pe.seller_sku, ''))) AS sku_norm,
      lower(btrim(COALESCE(pe.seller_custom_field, ''))) AS scf_norm,
      lower(btrim(COALESCE(pe.model, ''))) AS model_norm,
      lower(regexp_replace(COALESCE(pe.seller_sku, ''), '[^0-9a-zA-Z]', '', 'g')) AS sku_alnum,
      lower(regexp_replace(COALESCE(pe.seller_custom_field, ''), '[^0-9a-zA-Z]', '', 'g')) AS scf_alnum,
      lower(regexp_replace(COALESCE(pe.ean, ''), '[^0-9a-zA-Z]', '', 'g')) AS ean_norm,
      lower(regexp_replace(COALESCE(pe.gtin, ''), '[^0-9a-zA-Z]', '', 'g')) AS gtin_norm,
      lower(regexp_replace(COALESCE(pe.upc, ''), '[^0-9a-zA-Z]', '', 'g')) AS upc_norm,
      pe.id_producto_catalogo,
      pe.par_item_id,
      pe.visits_30d,
      pe.precio_venta,
      pe.actualizado_el
    FROM public.publicaciones_externas pe
    WHERE (pe.esta_mapeado IS NULL OR pe.esta_mapeado = false)
      AND NOT (COALESCE(pe.tipo_publicacion, '') = 'catalogo' AND pe.par_item_id IS NOT NULL)
      AND COALESCE(pe.es_bundle, false) = false
      AND NOT (COALESCE(pe.tags, '{}'::text[]) @> ARRAY['bundle']::text[])
      AND NOT (COALESCE(pe.channels, '{}'::text[]) @> ARRAY['private']::text[])
      AND COALESCE(pe.external_variation_id, '0') = '0'
      AND (
        length(btrim(COALESCE(p_search, ''))) < 2
        OR pe.titulo ILIKE '%' || btrim(p_search) || '%'
        OR pe.external_item_id ILIKE '%' || btrim(p_search) || '%'
        OR pe.brand ILIKE '%' || btrim(p_search) || '%'
        OR pe.model ILIKE '%' || btrim(p_search) || '%'
        OR pe.seller_sku ILIKE '%' || btrim(p_search) || '%'
        OR pe.ean ILIKE '%' || btrim(p_search) || '%'
        OR pe.gtin ILIKE '%' || btrim(p_search) || '%'
      )
  ),
  art_keys AS MATERIALIZED (
    SELECT
      a.articulo_id,
      a.nombre,
      a.marca,
      a.modelo,
      a.variante,
      a.codigo_universal,
      a.caja_madre,
      lower(btrim(COALESCE(a.articulo_id, ''))) AS aid_key,
      lower(btrim(COALESCE(a.modelo, ''))) AS mod_key,
      lower(regexp_replace(COALESCE(a.codigo_universal, ''), '[^0-9a-zA-Z]', '', 'g')) AS cod_key,
      translate(lower(btrim(COALESCE(a.marca, ''))), 'áéíóúü', 'aeiouu') AS marca_key
    FROM public.articulos a
    WHERE COALESCE(a.nombre, '') NOT LIKE '%PLACEHOLDER%'
      AND translate(lower(COALESCE(a.caja_madre, '')), 'áéíóú', 'aeiou') NOT LIKE '%devolucion%'
  ),
  alias_art AS MATERIALIZED (
    SELECT DISTINCT
      lower(regexp_replace(COALESCE(pa.codigo_excel, ''), '[^0-9a-zA-Z]', '', 'g')) AS k,
      pa.articulo_id
    FROM public.proveedor_articulos_alias pa
    WHERE pa.estado_proveedor = 'activo'
      AND pa.articulo_id IS NOT NULL
      AND length(regexp_replace(COALESCE(pa.codigo_excel, ''), '[^0-9a-zA-Z]', '', 'g')) >= 3
  ),
  hermanas AS MATERIALIZED (
    SELECT DISTINCT key_val, mpa.articulo_id
    FROM (
      SELECT pe.id_producto_catalogo AS key_val, pe.id
      FROM public.publicaciones_externas pe
      WHERE pe.id_producto_catalogo IS NOT NULL AND btrim(pe.id_producto_catalogo) <> ''
      UNION ALL
      SELECT pe.par_item_id AS key_val, pe.id
      FROM public.publicaciones_externas pe
      WHERE pe.par_item_id IS NOT NULL AND btrim(pe.par_item_id) <> ''
    ) h
    JOIN public.mapeo_publicacion_articulo mpa ON mpa.publicacion_id = h.id
  ),
  cand AS (
    -- SKU -> articulo_id
    SELECT p.id AS pub_id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 35 AS pts_sku, 0 AS pts_cod, 'sku_exacto' AS metodo
    FROM pendientes p JOIN art_keys a ON a.aid_key = p.sku_norm WHERE p.sku_norm <> ''
    UNION ALL
    -- SCF -> articulo_id
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 35, 0, 'sku_exacto'
    FROM pendientes p JOIN art_keys a ON a.aid_key = p.scf_norm WHERE p.scf_norm <> ''
    UNION ALL
    -- SKU -> modelo
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 35, 0, 'sku_exacto'
    FROM pendientes p JOIN art_keys a ON a.mod_key = p.sku_norm WHERE p.sku_norm <> ''
    UNION ALL
    -- SCF -> modelo
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 35, 0, 'sku_exacto'
    FROM pendientes p JOIN art_keys a ON a.mod_key = p.scf_norm WHERE p.scf_norm <> ''
    UNION ALL
    -- model -> modelo
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 35, 0, 'marca_modelo'
    FROM pendientes p JOIN art_keys a ON a.mod_key = p.model_norm WHERE length(p.model_norm) >= 3
    UNION ALL
    -- código -> codigo_universal (ean/gtin/upc)
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 0, 25, 'codigo_exacto'
    FROM pendientes p JOIN art_keys a ON a.cod_key = p.ean_norm WHERE length(p.ean_norm) >= 6
    UNION ALL
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 0, 25, 'codigo_exacto'
    FROM pendientes p JOIN art_keys a ON a.cod_key = p.gtin_norm WHERE length(p.gtin_norm) >= 6
    UNION ALL
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 0, 25, 'codigo_exacto'
    FROM pendientes p JOIN art_keys a ON a.cod_key = p.upc_norm WHERE length(p.upc_norm) >= 6
    UNION ALL
    -- alias de proveedor -> articulo_id
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 35, 0, 'alias'
    FROM pendientes p JOIN alias_art al ON al.k = p.sku_alnum AND p.sku_alnum <> ''
    JOIN art_keys a ON a.articulo_id = al.articulo_id
    UNION ALL
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 35, 0, 'alias'
    FROM pendientes p JOIN alias_art al ON al.k = p.scf_alnum AND p.scf_alnum <> ''
    JOIN art_keys a ON a.articulo_id = al.articulo_id
    UNION ALL
    -- hermana de catálogo ya mapeada
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 35, 0, 'hermana_mapeada'
    FROM pendientes p JOIN hermanas h ON h.key_val = p.id_producto_catalogo AND p.id_producto_catalogo IS NOT NULL AND btrim(p.id_producto_catalogo) <> ''
    JOIN art_keys a ON a.articulo_id = h.articulo_id
    UNION ALL
    SELECT p.id, a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre, a.marca_key, 35, 0, 'hermana_mapeada'
    FROM pendientes p JOIN hermanas h ON h.key_val = p.par_item_id AND p.par_item_id IS NOT NULL AND btrim(p.par_item_id) <> ''
    JOIN art_keys a ON a.articulo_id = h.articulo_id
  ),
  agg AS (
    SELECT
      pub_id, articulo_id, nombre, marca, modelo, variante, codigo_universal, caja_madre, marca_key,
      MAX(pts_sku) AS pts_sku,
      MAX(pts_cod) AS pts_cod,
      MAX(metodo) AS metodo_base
    FROM cand
    GROUP BY pub_id, articulo_id, nombre, marca, modelo, variante, codigo_universal, caja_madre, marca_key
  ),
  scored AS (
    SELECT
      a.pub_id,
      a.articulo_id, a.nombre, a.marca, a.modelo, a.variante, a.codigo_universal, a.caja_madre,
      CASE
        WHEN a.pts_sku > 0 AND a.pts_cod > 0 THEN 'sku_y_codigo_exacto'
        ELSE a.metodo_base
      END AS metodo,
      GREATEST(0, LEAST(100,
        a.pts_sku + a.pts_cod
        + CASE
            WHEN p.brand_key = a.marca_key AND a.marca_key <> '' THEN 20
            WHEN a.marca_key <> '' AND p.brand_key <> ''
                 AND (p.brand_key LIKE '%' || a.marca_key || '%' OR a.marca_key LIKE '%' || p.brand_key || '%') THEN 12
            WHEN a.marca_key <> '' AND p.brand_key <> '' THEN -15
            ELSE 0
          END
        + round(similarity(p.titulo_norm, lower(btrim(COALESCE(a.nombre, '')))) * 20)::int
      )) AS score
    FROM agg a
    JOIN pendientes p ON p.id = a.pub_id
  ),
  best AS (
    SELECT DISTINCT ON (pub_id) *
    FROM scored
    ORDER BY pub_id, score DESC, (caja_madre IS NOT NULL AND btrim(caja_madre) <> '') DESC, articulo_id ASC
  )
  SELECT
    p.id AS pub_id,
    count(*) OVER () AS total_count,
    COALESCE(b.score, 0) AS sug_score,
    CASE WHEN b.score > 0 THEN b.metodo ELSE 'sin_match' END AS sug_metodo,
    CASE
      WHEN b.score >= 95 THEN 'Coincidencia total: Marca, Modelo/SKU, Código y Nombre'
      WHEN b.score >= 70 THEN 'Coincidencia alta: Marca, Modelo/SKU y Nombre (sin código)'
      WHEN b.score >= 55 THEN 'Coincidencia parcial: Código y Marca (Modelo/SKU distinto)'
      WHEN b.score > 0 THEN 'Coincidencia baja: solo un campo (discrepa marca/modelo)'
      ELSE 'Sin coincidencia confiable'
    END AS sug_motivo,
    COALESCE(b.articulo_id, NULL) AS art_id,
    COALESCE(b.nombre, NULL) AS art_nombre,
    COALESCE(b.marca, NULL) AS art_marca,
    COALESCE(b.modelo, NULL) AS art_modelo,
    COALESCE(b.variante, NULL) AS art_variante,
    COALESCE(b.codigo_universal, NULL) AS art_codigo_universal,
    COALESCE(b.caja_madre, NULL) AS art_caja_madre
  FROM pendientes p
  LEFT JOIN best b ON b.pub_id = p.id
  ORDER BY
    COALESCE(b.score, 0) DESC,
    CASE WHEN p_order_by = 'precio_venta' THEN p.precio_venta END DESC NULLS LAST,
    CASE WHEN p_order_by = 'actualizado_el' THEN extract(epoch FROM p.actualizado_el) END DESC NULLS LAST,
    p.visits_30d DESC NULLS LAST,
    p.id ASC
  LIMIT GREATEST(1, p_limit)
  OFFSET GREATEST(0, p_offset);
$$;

GRANT EXECUTE ON FUNCTION public.fn_cola_mapeo_pendientes(text,text,integer,integer)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
