-- v30d_fix_par_item_id.sql
-- Corrige los 67 catálogos que comparten id_producto_catalogo con una publicación
-- tradicional pero tienen par_item_id = NULL.
-- Causa: el enriquecimiento almacenaba par_item_id solo cuando la API de MeLi lo
-- devolvía explícitamente; si llegaba vacío o era una versión legacy del endpoint,
-- quedaba NULL aunque la relación existía (detectable vía id_producto_catalogo compartido).

-- ─── UPDATE masivo único (67 casos históricos) ───────────────────────────────
UPDATE publicaciones_externas AS cat
SET    par_item_id = trad.external_item_id
FROM   publicaciones_externas AS trad
WHERE  cat.tipo_publicacion IN ('catalogo', 'catalogo_derivada')
  AND  cat.par_item_id IS NULL
  AND  cat.id_producto_catalogo IS NOT NULL
  AND  trad.tipo_publicacion = 'tradicional'
  AND  trad.id_producto_catalogo = cat.id_producto_catalogo
  AND  trad.external_variation_id = '0';

-- ─── Función RPC para enriquecimiento continuo (llamada por el worker) ────────
-- El adapter llama supabase.rpc('fix_par_item_id_faltantes', { p_marketplace_id })
-- al final de cada ciclo de enriquecimiento para prevenir nuevos casos.
CREATE OR REPLACE FUNCTION fix_par_item_id_faltantes(p_marketplace_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
    UPDATE publicaciones_externas AS cat
    SET    par_item_id = trad.external_item_id
    FROM   publicaciones_externas AS trad
    WHERE  cat.marketplace_id = p_marketplace_id
      AND  cat.tipo_publicacion IN ('catalogo', 'catalogo_derivada')
      AND  cat.par_item_id IS NULL
      AND  cat.id_producto_catalogo IS NOT NULL
      AND  trad.tipo_publicacion = 'tradicional'
      AND  trad.id_producto_catalogo = cat.id_producto_catalogo
      AND  trad.external_variation_id = '0';
$$;

-- ─── Verificación ─────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM publicaciones_externas
-- WHERE tipo_publicacion IN ('catalogo','catalogo_derivada')
--   AND par_item_id IS NULL
--   AND id_producto_catalogo IS NOT NULL;
-- Debe retornar 0 (o solo catálogos cuya tradicional hermana no está en la BD)
