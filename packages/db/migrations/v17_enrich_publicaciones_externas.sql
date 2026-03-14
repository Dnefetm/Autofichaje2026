-- Migración V17: Enriquecer publicaciones_externas con campos de MeLi
-- Fecha: 13-mar-2026

ALTER TABLE publicaciones_externas
  ADD COLUMN IF NOT EXISTS sold_quantity integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS listing_type_id text,
  ADD COLUMN IF NOT EXISTS logistic_type text,
  ADD COLUMN IF NOT EXISTS free_shipping boolean,
  ADD COLUMN IF NOT EXISTS health numeric,
  ADD COLUMN IF NOT EXISTS tags text[],
  ADD COLUMN IF NOT EXISTS original_price numeric,
  ADD COLUMN IF NOT EXISTS category_id text,
  ADD COLUMN IF NOT EXISTS domain_id text,
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS seller_sku text,
  ADD COLUMN IF NOT EXISTS sub_status text[],
  ADD COLUMN IF NOT EXISTS channels text[],
  ADD COLUMN IF NOT EXISTS meli_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS meli_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deal_ids text[],
  ADD COLUMN IF NOT EXISTS warranty text,
  ADD COLUMN IF NOT EXISTS currency_id text,
  ADD COLUMN IF NOT EXISTS initial_quantity integer;

-- Verificación: ejecutar esto para confirmar que las 20 columnas aparecen
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'publicaciones_externas'
-- ORDER BY ordinal_position;
