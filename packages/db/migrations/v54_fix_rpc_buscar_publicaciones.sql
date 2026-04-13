-- ============================================================
-- v54: Fix RPC buscar_publicaciones
--
-- Cambios vs v23:
--   1. Agrega columnas faltantes al RETURNS TABLE:
--        model text, comision_porcentaje numeric, visits_30d integer
--   2. Filtra por tipo_publicacion para consistencia con la query normal
--      (excluye catálogos con par_item_id, incluye 'up' y 'tradicional')
--   3. Agrega brand y model al WHERE de texto (búsqueda por marca/modelo)
--   4. Agrega brand y model al scoring de relevancia
--   5. health: mantiene double precision (igual que la columna en BD)
--   6. Limpieza de 31 seller_sku basura residuales
-- ============================================================

-- ─── PARTE 1: Limpiar seller_sku basura legacy ────────────────────────────────
-- 31 registros con seller_sku de exactamente 8 chars hexadecimales
-- (prefijos de UUID heredados de la migración V27, antes de isSkuGarbage).
UPDATE publicaciones_externas
SET seller_sku = NULL
WHERE seller_sku ~ '^[0-9a-f]{8}$';


-- ─── PARTE 2: Reemplazar RPC buscar_publicaciones ─────────────────────────────
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
  health                double precision,   -- igual que la columna en BD
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
  model                 text,              -- NUEVO: faltaba en v23
  comision_porcentaje   numeric,           -- NUEVO: faltaba en v23
  visits_30d            integer,           -- NUEVO: faltaba en v23
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
      pe.model,
      pe.comision_porcentaje,
      pe.visits_30d,
      CASE
        -- Match exacto en SKU / ID / modelo
        WHEN pe.seller_custom_field = p_term               THEN 100
        WHEN pe.seller_sku = p_term                        THEN 100
        WHEN pe.external_item_id = p_term                  THEN 100
        WHEN pe.model = p_term                             THEN 90
        -- Match prefijo en SKU / modelo
        WHEN pe.seller_custom_field ILIKE p_term || '%'    THEN 80
        WHEN pe.seller_sku          ILIKE p_term || '%'    THEN 80
        WHEN pe.external_item_id    ILIKE p_term || '%'    THEN 60
        WHEN pe.model               ILIKE p_term || '%'    THEN 50
        -- SKU / SCF contiene el término
        WHEN pe.seller_custom_field ILIKE '%' || p_term || '%' THEN 40
        WHEN pe.seller_sku          ILIKE '%' || p_term || '%' THEN 40
        -- Título contiene el término
        WHEN pe.titulo              ILIKE '%' || p_term || '%' THEN 20
        -- Marca contiene el término
        WHEN pe.brand               ILIKE '%' || p_term || '%' THEN 15
        -- Modelo contiene el término
        WHEN pe.model               ILIKE '%' || p_term || '%' THEN 10
        ELSE 0
      END AS relevance_score,
      COUNT(*) OVER () AS total_count
    FROM publicaciones_externas pe
    WHERE
      (p_marketplace_id IS NULL OR pe.marketplace_id = p_marketplace_id)
      AND pe.external_variation_id = '0'
      -- FIX: consistencia con la query normal (no muestra catálogos con par_item_id)
      AND (
        pe.tipo_publicacion = 'tradicional'
        OR pe.tipo_publicacion = 'up'
        OR pe.tipo_publicacion IS NULL
        OR (pe.tipo_publicacion IN ('catalogo', 'catalogo_derivada') AND pe.par_item_id IS NULL)
      )
      -- Condición de texto: título, ID, SKU, marca, modelo
      AND (
        pe.titulo               ILIKE '%' || p_term || '%'
        OR pe.external_item_id  ILIKE '%' || p_term || '%'
        OR pe.seller_custom_field = p_term
        OR pe.seller_sku          = p_term
        OR pe.seller_custom_field ILIKE '%' || p_term || '%'
        OR pe.seller_sku          ILIKE '%' || p_term || '%'
        OR pe.brand               ILIKE '%' || p_term || '%'
        OR pe.model               ILIKE '%' || p_term || '%'
      )
  )
  SELECT *
  FROM matches
  WHERE relevance_score > 0
  ORDER BY relevance_score DESC, sold_quantity DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$$;
