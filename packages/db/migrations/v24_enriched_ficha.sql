-- v24: Campos enriquecidos para ficha de producto + fix SKU cobertura
-- Ejecutar en Supabase SQL Editor (proyecto fichas-tecnicas-auto)

ALTER TABLE publicaciones_externas
  ADD COLUMN IF NOT EXISTS model          text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ean            text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gtin           text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS upc            text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pictures_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_mode  text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS local_pick_up  boolean DEFAULT false;

-- Índices para búsqueda/filtrado futuro
CREATE INDEX IF NOT EXISTS idx_pe_ean  ON publicaciones_externas (ean)  WHERE ean  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pe_gtin ON publicaciones_externas (gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pe_model ON publicaciones_externas (model) WHERE model IS NOT NULL;
