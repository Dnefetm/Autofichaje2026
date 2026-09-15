-- =============================================================================
-- T1 Logística Full — columnas de reposición (replenishment de MeLi).
-- El endpoint /marketplace/fbm/user-products/{user_product_id}/replenishment
-- devuelve: sugerencia de envío de ML, urgencia, deadline y ventas 30d nativas.
-- =============================================================================

ALTER TABLE publicaciones_externas
  ADD COLUMN IF NOT EXISTS user_product_id TEXT,
  ADD COLUMN IF NOT EXISTS replenishment_suggested INTEGER,
  ADD COLUMN IF NOT EXISTS shipping_urgency TEXT,
  ADD COLUMN IF NOT EXISTS replenishment_deadline TEXT,
  ADD COLUMN IF NOT EXISTS sales_30d_full INTEGER,
  ADD COLUMN IF NOT EXISTS replenishment_updated_at TIMESTAMPTZ;
