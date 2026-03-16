-- ============================================================
-- v23: Associated count + Universal Search RPC + Fase 1 fields
-- Proyecto: Autofichaje2026 | Supabase: ryxdqnzyvnrwalylqyvm
-- ============================================================

-- ─── PARTE 1 — MEJORA 1: associated_count ────────────────────────────────────

ALTER TABLE publicaciones_externas
  ADD COLUMN IF NOT EXISTS associated_count integer DEFAULT 0;

-- Backfill: para cada pub con id_producto_catalogo, contar cuántas OTRAS pubs
-- (distintos external_item_id) comparten ese mismo id_producto_catalogo
UPDATE publicaciones_externas pe
SET associated_count = sub.cnt
FROM (
  SELECT
    a.id,
    (SELECT COUNT(DISTINCT b.external_item_id)
     FROM publicaciones_externas b
     WHERE b.id_producto_catalogo = a.id_producto_catalogo
       AND b.external_item_id != a.external_item_id
       AND b.external_variation_id = '0'
    ) AS cnt
  FROM publicaciones_externas a
  WHERE a.id_producto_catalogo IS NOT NULL
    AND a.external_variation_id = '0'
) sub
WHERE pe.id = sub.id;

-- Índice para lazy-load de asociadas (par id_producto_catalogo)
CREATE INDEX IF NOT EXISTS idx_pe_producto_catalogo
  ON publicaciones_externas (id_producto_catalogo, external_variation_id)
  WHERE id_producto_catalogo IS NOT NULL;

-- RPC incremental para associated_count
CREATE OR REPLACE FUNCTION recalcular_associated_count(
  p_account_id uuid,
  p_item_ids   text[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE publicaciones_externas pe
  SET associated_count = (
    SELECT COUNT(DISTINCT b.external_item_id)
    FROM publicaciones_externas b
    WHERE b.id_producto_catalogo = pe.id_producto_catalogo
      AND b.external_item_id != pe.external_item_id
      AND b.external_variation_id = '0'
  )
  WHERE pe.marketplace_id = p_account_id
    AND pe.external_item_id = ANY(p_item_ids)
    AND pe.external_variation_id = '0'
    AND pe.id_producto_catalogo IS NOT NULL;
$$;


-- ─── PARTE 2 — MEJORA 2: Búsqueda universal ──────────────────────────────────

-- Extensión trigram para búsquedas parciales eficientes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índices para búsqueda por SKU
CREATE INDEX IF NOT EXISTS idx_pe_seller_sku
  ON publicaciones_externas (seller_sku)
  WHERE seller_sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pe_seller_custom_field
  ON publicaciones_externas (seller_custom_field)
  WHERE seller_custom_field IS NOT NULL;

-- Índices trigram para búsqueda parcial
CREATE INDEX IF NOT EXISTS idx_pe_sku_trgm
  ON publicaciones_externas USING gin (seller_sku gin_trgm_ops)
  WHERE seller_sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pe_scf_trgm
  ON publicaciones_externas USING gin (seller_custom_field gin_trgm_ops)
  WHERE seller_custom_field IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pe_titulo_trgm
  ON publicaciones_externas USING gin (titulo gin_trgm_ops)
  WHERE titulo IS NOT NULL;

-- RPC de búsqueda con scoring de relevancia
-- Busca en TODAS las publicaciones (incluyendo catálogos con par_item_id ocultos)
CREATE OR REPLACE FUNCTION buscar_publicaciones(
  p_term         text,
  p_marketplace_id uuid DEFAULT NULL,
  p_limit        integer DEFAULT 100,
  p_offset       integer DEFAULT 0
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
      pe.es_bundle, pe.free_shipping, pe.logistic_type,
      pe.original_price, pe.domain_id, pe.condition,
      pe.tags, pe.permalink, pe.esta_mapeado, pe.marketplace_id,
      pe.sync_disabled,
      CASE
        -- Match exacto en SKU / ID
        WHEN pe.seller_custom_field = p_term               THEN 100
        WHEN pe.seller_sku = p_term                        THEN 100
        WHEN pe.external_item_id = p_term                  THEN 100
        -- Match prefijo en SKU
        WHEN pe.seller_custom_field ILIKE p_term || '%'    THEN 80
        WHEN pe.seller_sku          ILIKE p_term || '%'    THEN 80
        WHEN pe.external_item_id    ILIKE p_term || '%'    THEN 60
        -- SKU/SCF contiene el término
        WHEN pe.seller_custom_field ILIKE '%' || p_term || '%' THEN 40
        WHEN pe.seller_sku          ILIKE '%' || p_term || '%' THEN 40
        -- Título contiene el término
        WHEN pe.titulo              ILIKE '%' || p_term || '%' THEN 20
        ELSE 0
      END AS relevance_score,
      COUNT(*) OVER () AS total_count
    FROM publicaciones_externas pe
    WHERE
      (p_marketplace_id IS NULL OR pe.marketplace_id = p_marketplace_id)
      AND pe.external_variation_id = '0'   -- solo filas padre (no variaciones)
      AND (
        pe.titulo              ILIKE '%' || p_term || '%'
        OR pe.external_item_id ILIKE '%' || p_term || '%'
        OR pe.seller_custom_field = p_term
        OR pe.seller_sku        = p_term
        OR pe.seller_custom_field ILIKE '%' || p_term || '%'
        OR pe.seller_sku          ILIKE '%' || p_term || '%'
      )
  )
  SELECT *
  FROM matches
  WHERE relevance_score > 0
  ORDER BY relevance_score DESC, sold_quantity DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$$;


-- ─── PARTE 3 — FASE 1: Campos adicionales del multiGET ───────────────────────

ALTER TABLE publicaciones_externas
  ADD COLUMN IF NOT EXISTS shipping_tags      jsonb   DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS shipping_dimensions jsonb  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS inventory_id       text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS video_id           text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS base_price         numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS automatic_relist   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS buying_mode        text    DEFAULT NULL;

-- Índice para filtrar por fulfillment vía shipping_tags (GIN)
CREATE INDEX IF NOT EXISTS idx_pe_shipping_tags
  ON publicaciones_externas USING gin (shipping_tags);

-- ─── Verificaciones (comentadas — ejecutar manualmente si se desea) ───────────
-- SELECT COUNT(*) FROM publicaciones_externas WHERE associated_count > 0 AND external_variation_id = '0';
-- SELECT * FROM buscar_publicaciones('Victorinox', NULL, 10);
