-- 20261014: columna propia para marcar publicaciones "fantasma" de MeLi
-- (Publicación gratuita deprecada: listing_type_id='free', o cerradas: status_externo='closed').
-- No se borra nada ni se toca MeLi; solo se marca para revisión del usuario.

ALTER TABLE public.publicaciones_externas
  ADD COLUMN IF NOT EXISTS posible_eliminada boolean NOT NULL DEFAULT false;

UPDATE public.publicaciones_externas
   SET posible_eliminada = true
 WHERE status_externo = 'closed'
    OR listing_type_id = 'free';

-- Limpiar cualquier tag temporal usado antes de existir la columna.
UPDATE public.publicaciones_externas
   SET tags = array_remove(tags, 'posible_eliminada')
 WHERE 'posible_eliminada' = ANY(tags);

-- Exponer la marca en la búsqueda de vitrinas (buscar_publicaciones).
CREATE OR REPLACE FUNCTION buscar_publicaciones(
  p_term           text,
  p_marketplace_id uuid    DEFAULT NULL,
  p_limit          integer DEFAULT 100,
  p_offset         integer DEFAULT 0
)
RETURNS TABLE (
  id                    uuid,
  external_item_id      text,
  external_variation_id text,
  titulo                text,
  tipo_publicacion      text,
  status_externo        text,
  listing_type_id       text,
  precio_venta          numeric,
  sold_quantity         integer,
  stock_publicado       integer,
  health                double precision,
  seller_custom_field   text,
  seller_sku            text,
  brand                 text,
  url_imagen            text,
  par_item_id           text,
  id_producto_catalogo  text,
  catalog_count         integer,
  associated_count      integer,
  posible_eliminada     boolean,
  es_bundle             boolean,
  free_shipping         boolean,
  logistic_type         text,
  original_price        numeric,
  domain_id             text,
  condition             text,
  tags                  text[],
  permalink             text,
  esta_mapeado          boolean,
  marketplace_id        uuid,
  sync_disabled         boolean,
  model                 text,
  ean                   text,
  gtin                  text,
  upc                   text,
  variation_attributes  jsonb,
  comision_porcentaje   numeric,
  visits_30d            integer,
  relevance_score       integer,
  total_count           bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH matches AS (
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
      CASE
        WHEN pe.seller_custom_field = p_term               THEN 100
        WHEN pe.seller_sku = p_term                        THEN 100
        WHEN pe.external_item_id = p_term                  THEN 100
        WHEN pe.inventory_id = p_term                      THEN 100
        WHEN pe.ean = p_term                               THEN 95
        WHEN pe.gtin = p_term                              THEN 95
        WHEN pe.upc = p_term                               THEN 95
        WHEN pe.model = p_term                             THEN 90
        WHEN pe.seller_custom_field ILIKE p_term || '%'    THEN 80
        WHEN pe.seller_sku          ILIKE p_term || '%'    THEN 80
        WHEN pe.inventory_id        ILIKE p_term || '%'    THEN 80
        WHEN pe.external_item_id    ILIKE p_term || '%'    THEN 60
        WHEN pe.model               ILIKE p_term || '%'    THEN 50
        WHEN pe.seller_custom_field ILIKE '%' || p_term || '%' THEN 40
        WHEN pe.seller_sku          ILIKE '%' || p_term || '%' THEN 40
        WHEN pe.external_item_id    ILIKE '%' || p_term || '%' THEN 30
        WHEN pe.inventory_id        ILIKE '%' || p_term || '%' THEN 30
        WHEN pe.ean                 ILIKE '%' || p_term || '%' THEN 25
        WHEN pe.gtin                ILIKE '%' || p_term || '%' THEN 25
        WHEN pe.upc                 ILIKE '%' || p_term || '%' THEN 25
        WHEN pe.titulo              ILIKE '%' || p_term || '%' THEN 20
        WHEN pe.brand               ILIKE '%' || p_term || '%' THEN 15
        WHEN pe.model               ILIKE '%' || p_term || '%' THEN 10
        ELSE 0
      END AS relevance_score,
      0::bigint AS total_count
    FROM publicaciones_externas pe
    WHERE
      (p_marketplace_id IS NULL OR pe.marketplace_id = p_marketplace_id)
      AND pe.external_variation_id = '0'
      AND (
        pe.titulo               ILIKE '%' || p_term || '%'
        OR pe.external_item_id  ILIKE '%' || p_term || '%'
        OR pe.inventory_id      ILIKE '%' || p_term || '%'
        OR pe.seller_custom_field = p_term
        OR pe.seller_sku          = p_term
        OR pe.seller_custom_field ILIKE '%' || p_term || '%'
        OR pe.seller_sku          ILIKE '%' || p_term || '%'
        OR pe.brand               ILIKE '%' || p_term || '%'
        OR pe.model               ILIKE '%' || p_term || '%'
        OR pe.ean                 ILIKE '%' || p_term || '%'
        OR pe.gtin                ILIKE '%' || p_term || '%'
        OR pe.upc                 ILIKE '%' || p_term || '%'
      )
  )
  SELECT *
  FROM matches
  WHERE relevance_score > 0
  ORDER BY relevance_score DESC, sold_quantity DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$$;
