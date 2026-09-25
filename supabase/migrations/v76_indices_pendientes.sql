-- v76: Índices para acelerar la cola de pendientes (búsqueda + filtros + orden).
-- La consulta filtra por esta_mapeado IS NULL/false, external_variation_id='0',
-- ordena por visits_30d/precio/actualizado y busca con ILIKE '%…%'.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Filas sin mapear (filtro principal de la cola)
CREATE INDEX IF NOT EXISTS idx_pub_esta_mapeado_pendientes
  ON publicaciones_externas (esta_mapeado)
  WHERE esta_mapeado IS NULL OR esta_mapeado = false;

-- Fila padre (no variaciones)
CREATE INDEX IF NOT EXISTS idx_pub_external_variation_id
  ON publicaciones_externas (external_variation_id);

-- Criterios de orden de la cola
CREATE INDEX IF NOT EXISTS idx_pub_visits_30d ON publicaciones_externas (visits_30d DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pub_precio_venta ON publicaciones_externas (precio_venta DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pub_actualizado_el ON publicaciones_externas (actualizado_el DESC NULLS LAST);

-- Búsqueda con ILIKE '%…%' (comodín inicial → trigram)
CREATE INDEX IF NOT EXISTS idx_pub_external_item_id_trgm ON publicaciones_externas USING gin (external_item_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pub_brand_trgm ON publicaciones_externas USING gin (brand gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pub_model_trgm ON publicaciones_externas USING gin (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pub_ean_trgm ON publicaciones_externas USING gin (ean gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pub_gtin_trgm ON publicaciones_externas USING gin (gtin gin_trgm_ops);
