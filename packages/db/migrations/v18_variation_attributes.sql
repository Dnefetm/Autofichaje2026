-- Migración V18: Atributos de variantes en publicaciones_externas
-- Fecha: 14-mar-2026

-- 1. Tres columnas nuevas para datos de variantes
ALTER TABLE publicaciones_externas
    ADD COLUMN IF NOT EXISTS variation_attributes JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS variation_picture_ids TEXT[] DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS seller_custom_field TEXT DEFAULT NULL;

-- 2. Índice GIN para búsquedas eficientes en variation_attributes
CREATE INDEX IF NOT EXISTS idx_pe_variation_attrs
    ON publicaciones_externas USING GIN (variation_attributes);

-- Verificación:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'publicaciones_externas' ORDER BY ordinal_position;
