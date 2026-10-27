-- ============================================================================
-- Migración: 2026102603_optimizacion_busqueda_facets_y_cola_pendientes.sql
-- Descripción:
--   1. Índice GIN trigrama en publicaciones_externas.inventory_id + índice B-tree
--      compuesto (lower(brand), sold_quantity DESC NULLS LAST).
--   2. Limpieza de los 5 índices GIN trigrama duplicados (idx_pub_*_trgm que
--      duplicaban a idx_pe_*_trgm).
--   3. Optimización de public.buscar_publicaciones():
--      - Elimina count(*) OVER () (WindowAgg) devolviendo 0::bigint AS total_count.
--      - Aplica Opción 2 en el WHERE: subcadena (%term%) solo en texto libre
--        (titulo, brand, model), prefijo (term%) en SKUs/IDs y exacto en códigos
--        de barras (ean, gtin, upc), eliminando la contaminación de idx_pe_ean.
--      - Difiere la lectura de las 38 columnas al LIMIT p_limit final.
--   4. RPC ligera fn_facets_publicaciones_externas() para evitar descargar
--      toda la tabla 2 veces al cliente al montar /catalog/external.
--   5. RPC de pre-ordenamiento grueso fn_cola_mapeo_pendientes() sin tope
--      artificial de 200 en p_limit.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Índice GIN trigrama en inventory_id + B-tree de marca y ventas
CREATE INDEX IF NOT EXISTS idx_pub_ext_inventory_id_trgm
  ON public.publicaciones_externas
  USING gin (inventory_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_pe_brand_lower_sold
  ON public.publicaciones_externas (lower(brand), sold_quantity DESC NULLS LAST)
  WHERE external_variation_id = '0';

-- 2. Eliminar los 5 índices GIN trigrama duplicados (se conservan idx_pe_*_trgm)
DROP INDEX IF EXISTS
  public.idx_pub_brand_trgm,
  public.idx_pub_ean_trgm,
  public.idx_pub_external_item_id_trgm,
  public.idx_pub_gtin_trgm,
  public.idx_pub_model_trgm;

-- 3. Optimización de buscar_publicaciones (sin WindowAgg + Opción 2 + 38 cols diferidas)
CREATE OR REPLACE FUNCTION public.buscar_publicaciones(
  p_term text,
  p_marketplace_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  external_item_id text,
  external_variation_id text,
  titulo text,
  tipo_publicacion text,
  status_externo text,
  listing_type_id text,
  precio_venta numeric,
  sold_quantity integer,
  stock_publicado integer,
  health double precision,
  seller_custom_field text,
  seller_sku text,
  brand text,
  url_imagen text,
  par_item_id text,
  id_producto_catalogo text,
  catalog_count integer,
  associated_count integer,
  posible_eliminada boolean,
  es_bundle boolean,
  free_shipping boolean,
  logistic_type text,
  original_price numeric,
  domain_id text,
  condition text,
  tags text[],
  permalink text,
  esta_mapeado boolean,
  marketplace_id uuid,
  sync_disabled boolean,
  model text,
  ean text,
  gtin text,
  upc text,
  variation_attributes jsonb,
  comision_porcentaje numeric,
  visits_30d integer,
  relevance_score integer,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $function$
  WITH q AS (
    SELECT lower(btrim(COALESCE(p_term, ''))) AS term
  ),
  scored AS (
    SELECT
      pe.id,
      pe.sold_quantity,
      CASE
        WHEN lower(pe.seller_custom_field) = q.term
          OR lower(pe.seller_sku) = q.term
          OR lower(pe.external_item_id) = q.term
          OR lower(pe.inventory_id) = q.term
        THEN 100
        WHEN lower(pe.ean) = q.term
          OR lower(pe.gtin) = q.term
          OR lower(pe.upc) = q.term
        THEN 95
        WHEN lower(pe.model) = q.term
        THEN 90
        WHEN strpos(lower(COALESCE(pe.seller_custom_field, '')), q.term) = 1
          OR strpos(lower(COALESCE(pe.seller_sku, '')), q.term) = 1
          OR strpos(lower(COALESCE(pe.inventory_id, '')), q.term) = 1
        THEN 80
        WHEN strpos(lower(COALESCE(pe.external_item_id, '')), q.term) = 1
        THEN 60
        WHEN strpos(lower(COALESCE(pe.model, '')), q.term) = 1
        THEN 50
        WHEN strpos(lower(COALESCE(pe.titulo, '')), q.term) > 0
        THEN 20
        WHEN strpos(lower(COALESCE(pe.brand, '')), q.term) > 0
        THEN 15
        WHEN strpos(lower(COALESCE(pe.model, '')), q.term) > 0
        THEN 10
        ELSE 10
      END AS relevance_score
    FROM public.publicaciones_externas pe
    CROSS JOIN q
    WHERE
      (p_marketplace_id IS NULL OR pe.marketplace_id = p_marketplace_id)
      AND pe.external_variation_id = '0'
      AND NOT ('private' = ANY(COALESCE(pe.channels, '{}')) AND NOT ('marketplace' = ANY(COALESCE(pe.channels, '{}'))))
      AND (
        pe.titulo                 ILIKE '%' || btrim(p_term) || '%'
        OR pe.brand               ILIKE '%' || btrim(p_term) || '%'
        OR pe.model               ILIKE '%' || btrim(p_term) || '%'
        OR pe.external_item_id    ILIKE btrim(p_term) || '%'
        OR pe.inventory_id        ILIKE btrim(p_term) || '%'
        OR pe.seller_custom_field ILIKE btrim(p_term) || '%'
        OR pe.seller_sku          ILIKE btrim(p_term) || '%'
        OR pe.ean                 = btrim(p_term)
        OR pe.gtin                = btrim(p_term)
        OR pe.upc                 = btrim(p_term)
      )
  ),
  top_page AS MATERIALIZED (
    SELECT s.id, s.relevance_score
    FROM scored s
    ORDER BY s.relevance_score DESC, s.sold_quantity DESC NULLS LAST, s.id ASC
    LIMIT p_limit
    OFFSET p_offset
  )
  SELECT
    pe.id, pe.external_item_id, pe.external_variation_id,
    pe.titulo, pe.tipo_publicacion, pe.status_externo,
    pe.listing_type_id, pe.precio_venta, pe.sold_quantity,
    pe.stock_publicado, pe.health, pe.seller_custom_field,
    pe.seller_sku, pe.brand, pe.url_imagen, pe.par_item_id,
    pe.id_producto_catalogo, pe.catalog_count, pe.associated_count,
    pe.posible_eliminada,
    pe.es_bundle, pe.free_shipping, pe.logistic_type,
    pe.original_price, pe.domain_id, pe.condition,
    pe.tags, pe.permalink, pe.esta_mapeado, pe.marketplace_id,
    pe.sync_disabled, pe.model, pe.ean, pe.gtin, pe.upc, pe.variation_attributes,
    pe.comision_porcentaje, pe.visits_30d,
    tp.relevance_score,
    0::bigint AS total_count
  FROM top_page tp
  JOIN public.publicaciones_externas pe ON pe.id = tp.id
  ORDER BY tp.relevance_score DESC, pe.sold_quantity DESC NULLS LAST, pe.id ASC;
$function$;

-- 4. RPC ligera para facetas de Vitrinas MeLi (/catalog/external)
CREATE OR REPLACE FUNCTION public.fn_facets_publicaciones_externas()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'brands', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('value', brand, 'label', brand, 'count', cnt))
      FROM (
        SELECT brand, count(*)::int AS cnt
        FROM public.publicaciones_externas
        WHERE brand IS NOT NULL AND btrim(brand) <> ''
          AND COALESCE(status_externo, '') <> 'closed'
          AND NOT (COALESCE(channels, '{}'::text[]) @> ARRAY['private']::text[])
        GROUP BY brand
        ORDER BY cnt DESC, brand ASC
        LIMIT 20
      ) b
    ), '[]'::jsonb),
    'domains', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'value', domain_id,
        'label', COALESCE(NULLIF(regexp_replace(domain_id, '^.*-', ''), ''), domain_id),
        'count', cnt
      ))
      FROM (
        SELECT domain_id, count(*)::int AS cnt
        FROM public.publicaciones_externas
        WHERE domain_id IS NOT NULL AND btrim(domain_id) <> ''
          AND COALESCE(status_externo, '') <> 'closed'
          AND NOT (COALESCE(channels, '{}'::text[]) @> ARRAY['private']::text[])
        GROUP BY domain_id
        ORDER BY cnt DESC, domain_id ASC
        LIMIT 20
      ) d
    ), '[]'::jsonb)
  );
$$;

-- 5. RPC de pre-ordenamiento grueso para la cola de mapeo pendiente
CREATE OR REPLACE FUNCTION public.fn_cola_mapeo_pendientes(
  p_search text DEFAULT '',
  p_order_by text DEFAULT 'visits_30d',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  pub_id uuid,
  total_count bigint,
  match_tier integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH art_validos AS (
    SELECT
      lower(btrim(COALESCE(a.articulo_id, ''))) AS aid,
      lower(btrim(COALESCE(a.modelo, ''))) AS mod,
      lower(btrim(COALESCE(a.marca, ''))) AS mar,
      lower(regexp_replace(COALESCE(a.codigo_universal, ''), '[^0-9a-zA-Z]', '', 'g')) AS cod
    FROM public.articulos a
    WHERE COALESCE(a.nombre, '') NOT LIKE '%PLACEHOLDER%'
      AND translate(lower(COALESCE(a.caja_madre, '')), 'áéíóú', 'aeiou') NOT LIKE '%devolucion%'
  ),
  skus_set AS (
    SELECT DISTINCT k
    FROM (
      SELECT aid AS k FROM art_validos WHERE aid <> ''
      UNION ALL
      SELECT mod AS k FROM art_validos WHERE mod <> ''
    ) s
  ),
  cods_set AS (
    SELECT DISTINCT cod AS k
    FROM art_validos
    WHERE length(cod) >= 6
  ),
  alias_set AS (
    SELECT DISTINCT lower(regexp_replace(COALESCE(pa.codigo_excel, ''), '[^0-9a-zA-Z]', '', 'g')) AS k
    FROM public.proveedor_articulos_alias pa
    WHERE pa.estado_proveedor = 'activo'
      AND pa.articulo_id IS NOT NULL
      AND length(regexp_replace(COALESCE(pa.codigo_excel, ''), '[^0-9a-zA-Z]', '', 'g')) >= 3
  ),
  marca_modelo_set AS (
    SELECT DISTINCT mar, mod
    FROM art_validos
    WHERE mar <> '' AND mod <> ''
  ),
  modelo_set AS (
    SELECT DISTINCT mod
    FROM art_validos
    WHERE length(mod) >= 3
  ),
  hermanas_mapeadas AS (
    SELECT DISTINCT key_val
    FROM (
      SELECT pe.id_producto_catalogo AS key_val
      FROM public.publicaciones_externas pe
      JOIN public.mapeo_publicacion_articulo mpa ON mpa.publicacion_id = pe.id
      WHERE pe.id_producto_catalogo IS NOT NULL AND btrim(pe.id_producto_catalogo) <> ''
      UNION
      SELECT pe.par_item_id AS key_val
      FROM public.publicaciones_externas pe
      JOIN public.mapeo_publicacion_articulo mpa ON mpa.publicacion_id = pe.id
      WHERE pe.par_item_id IS NOT NULL AND btrim(pe.par_item_id) <> ''
    ) h
  ),
  pendientes_base AS (
    SELECT
      pe.id,
      pe.visits_30d,
      pe.precio_venta,
      pe.actualizado_el,
      lower(btrim(COALESCE(pe.seller_sku, ''))) AS sku_norm,
      lower(btrim(COALESCE(pe.seller_custom_field, ''))) AS scf_norm,
      lower(regexp_replace(COALESCE(pe.seller_sku, ''), '[^0-9a-zA-Z]', '', 'g')) AS sku_alnum,
      lower(regexp_replace(COALESCE(pe.seller_custom_field, ''), '[^0-9a-zA-Z]', '', 'g')) AS scf_alnum,
      lower(regexp_replace(COALESCE(pe.ean, ''), '[^0-9a-zA-Z]', '', 'g')) AS ean_norm,
      lower(regexp_replace(COALESCE(pe.gtin, ''), '[^0-9a-zA-Z]', '', 'g')) AS gtin_norm,
      lower(regexp_replace(COALESCE(pe.upc, ''), '[^0-9a-zA-Z]', '', 'g')) AS upc_norm,
      lower(btrim(COALESCE(pe.brand, ''))) AS brand_norm,
      lower(btrim(COALESCE(pe.model, ''))) AS model_norm,
      pe.id_producto_catalogo,
      pe.par_item_id
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
  clasificadas AS (
    SELECT
      pb.id AS pub_id,
      pb.visits_30d,
      pb.precio_venta,
      pb.actualizado_el,
      CASE
        WHEN (pb.id_producto_catalogo IS NOT NULL AND pb.id_producto_catalogo IN (SELECT key_val FROM hermanas_mapeadas))
          OR (pb.par_item_id IS NOT NULL AND pb.par_item_id IN (SELECT key_val FROM hermanas_mapeadas))
          OR (pb.sku_norm <> '' AND pb.sku_norm IN (SELECT k FROM skus_set))
          OR (pb.scf_norm <> '' AND pb.scf_norm IN (SELECT k FROM skus_set))
          OR (pb.ean_norm <> '' AND pb.ean_norm IN (SELECT k FROM cods_set))
          OR (pb.gtin_norm <> '' AND pb.gtin_norm IN (SELECT k FROM cods_set))
          OR (pb.upc_norm <> '' AND pb.upc_norm IN (SELECT k FROM cods_set))
          OR (pb.sku_alnum <> '' AND pb.sku_alnum IN (SELECT k FROM alias_set))
          OR (pb.scf_alnum <> '' AND pb.scf_alnum IN (SELECT k FROM alias_set))
        THEN 1
        WHEN pb.brand_norm <> '' AND pb.model_norm <> ''
          AND (pb.brand_norm, pb.model_norm) IN (SELECT mar, mod FROM marca_modelo_set)
        THEN 2
        WHEN length(pb.model_norm) >= 3
          AND pb.model_norm IN (SELECT mod FROM modelo_set)
        THEN 3
        ELSE 4
      END AS match_tier
    FROM pendientes_base pb
  )
  SELECT
    c.pub_id,
    count(*) OVER () AS total_count,
    c.match_tier
  FROM clasificadas c
  ORDER BY
    c.match_tier ASC,
    CASE WHEN p_order_by = 'precio_venta' THEN c.precio_venta END DESC NULLS LAST,
    CASE WHEN p_order_by = 'actualizado_el' THEN extract(epoch FROM c.actualizado_el) END DESC NULLS LAST,
    c.visits_30d DESC NULLS LAST,
    c.pub_id ASC
  LIMIT GREATEST(1, p_limit)
  OFFSET GREATEST(0, p_offset);
$$;
