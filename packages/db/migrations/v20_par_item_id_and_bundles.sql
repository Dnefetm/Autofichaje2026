-- v20: par_item_id (agrupación server-side Tradicional↔Catálogo) + es_bundle
-- Ejecutar en Supabase → SQL Editor → proyecto ryxdqnzyvnrwalylqyvm

-- ─── 1. Columnas nuevas ───────────────────────────────────────────────────────
ALTER TABLE publicaciones_externas
  ADD COLUMN IF NOT EXISTS par_item_id  text,
  ADD COLUMN IF NOT EXISTS es_bundle    boolean DEFAULT false;

-- Índice para buscar el par eficientemente desde el frontend
CREATE INDEX IF NOT EXISTS idx_pe_par_item_id
  ON publicaciones_externas (marketplace_id, par_item_id)
  WHERE par_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pe_es_bundle
  ON publicaciones_externas (marketplace_id, es_bundle)
  WHERE es_bundle = true;

-- ─── 2. Backfill es_bundle (tags[] contiene 'bundle') ─────────────────────────
UPDATE publicaciones_externas
SET es_bundle = true
WHERE tags IS NOT NULL
  AND 'bundle' = ANY(tags);

-- ─── 3. Backfill par_item_id ──────────────────────────────────────────────────
-- Para cada publicación con id_producto_catalogo, vincular su "par":
--   • Tradicional → busca su catálogo (activo con más ventas)
--   • Catálogo    → busca su tradicional (activa con más ventas)
-- Solo bases (external_variation_id = '0'), para no duplicar en variantes.
WITH pares AS (
  SELECT DISTINCT ON (a.id)
    a.id,
    b.external_item_id AS par_item_id
  FROM publicaciones_externas a
  JOIN publicaciones_externas b
    ON  a.id_producto_catalogo = b.id_producto_catalogo
    AND a.marketplace_id       = b.marketplace_id
    AND a.external_item_id    != b.external_item_id
    AND a.external_variation_id = '0'
    AND b.external_variation_id = '0'
    AND (
      (a.tipo_publicacion = 'tradicional'
        AND b.tipo_publicacion IN ('catalogo','catalogo_derivada'))
      OR
      (a.tipo_publicacion IN ('catalogo','catalogo_derivada')
        AND b.tipo_publicacion = 'tradicional')
    )
  ORDER BY
    a.id,
    CASE WHEN b.status_externo = 'active' THEN 0 ELSE 1 END,
    COALESCE(b.sold_quantity, 0) DESC
)
UPDATE publicaciones_externas pe
SET    par_item_id = pares.par_item_id
FROM   pares
WHERE  pe.id = pares.id;

-- ─── 4. Backfill seller_sku desde seller_custom_field en variantes ────────────
-- Para las 109 variantes que tienen seller_custom_field pero seller_sku = NULL
UPDATE publicaciones_externas
SET    seller_sku = seller_custom_field
WHERE  external_variation_id != '0'
  AND  seller_sku IS NULL
  AND  seller_custom_field IS NOT NULL;

-- ─── 5. Función RPC para recalcular par_item_id incremental (llamada desde meli.ts) ──
CREATE OR REPLACE FUNCTION recalcular_par_item_id(
    p_account_id uuid,
    p_item_ids    text[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  WITH pares AS (
    SELECT DISTINCT ON (a.id)
      a.id,
      b.external_item_id AS par_item_id
    FROM publicaciones_externas a
    JOIN publicaciones_externas b
      ON  a.id_producto_catalogo = b.id_producto_catalogo
      AND a.marketplace_id       = b.marketplace_id
      AND a.external_item_id    != b.external_item_id
      AND a.external_variation_id = '0'
      AND b.external_variation_id = '0'
      AND (
        (a.tipo_publicacion = 'tradicional'
          AND b.tipo_publicacion IN ('catalogo','catalogo_derivada'))
        OR
        (a.tipo_publicacion IN ('catalogo','catalogo_derivada')
          AND b.tipo_publicacion = 'tradicional')
      )
    WHERE a.marketplace_id = p_account_id
      AND a.external_item_id = ANY(p_item_ids)
    ORDER BY
      a.id,
      CASE WHEN b.status_externo = 'active' THEN 0 ELSE 1 END,
      COALESCE(b.sold_quantity, 0) DESC
  )
  UPDATE publicaciones_externas pe
  SET    par_item_id = pares.par_item_id
  FROM   pares
  WHERE  pe.id = pares.id;
$$;

-- Verificar resultados:
-- SELECT tipo_publicacion, COUNT(*) as total,
--        COUNT(par_item_id) as con_par,
--        COUNT(CASE WHEN es_bundle THEN 1 END) as bundles
-- FROM publicaciones_externas
-- WHERE external_variation_id = '0'
-- GROUP BY tipo_publicacion;
