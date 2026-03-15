-- v22: catalog_count column para mostrar badge de catálogos hijos sin lazy query
-- Ejecutar en Supabase SQL Editor → proyecto ryxdqnzyvnrwalylqyvm

-- ─── 1. Añadir columna catalog_count ─────────────────────────────────────────
ALTER TABLE publicaciones_externas
  ADD COLUMN IF NOT EXISTS catalog_count integer DEFAULT 0;

-- ─── 2. Backfill: para cada publicación tradicional, contar cuántas de catálogo
--        la tienen como par (par_item_id = external_item_id) ─────────────────
UPDATE publicaciones_externas pe
SET catalog_count = sub.cnt
FROM (
  SELECT par_item_id, COUNT(*) AS cnt
  FROM publicaciones_externas
  WHERE par_item_id IS NOT NULL
    AND tipo_publicacion IN ('catalogo', 'catalogo_derivada')
    AND external_variation_id = '0'
  GROUP BY par_item_id
) sub
-- La columna par_item_id de sub es el external_item_id de la tradicional
WHERE pe.external_item_id = sub.par_item_id
  AND pe.external_variation_id = '0';

-- ─── 3. Índice para filtro server-side (excluir catálogos con par de la query) ─
CREATE INDEX IF NOT EXISTS idx_pe_tipo_par
  ON publicaciones_externas (tipo_publicacion, par_item_id, external_variation_id);

-- ─── 4. Función RPC para recalcular catalog_count de forma incremental ────────
CREATE OR REPLACE FUNCTION recalcular_catalog_count(
    p_account_id uuid,
    p_item_ids    text[]
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE publicaciones_externas pe
  SET catalog_count = (
    SELECT COUNT(*)
    FROM publicaciones_externas c
    WHERE c.par_item_id = pe.external_item_id
      AND c.tipo_publicacion IN ('catalogo', 'catalogo_derivada')
      AND c.external_variation_id = '0'
  )
  WHERE pe.marketplace_id = p_account_id
    AND pe.external_item_id = ANY(p_item_ids)
    AND pe.external_variation_id = '0';
$$;

-- Verificar:
-- SELECT external_item_id, catalog_count, tipo_publicacion
-- FROM publicaciones_externas
-- WHERE catalog_count > 0 AND external_variation_id = '0'
-- LIMIT 20;
