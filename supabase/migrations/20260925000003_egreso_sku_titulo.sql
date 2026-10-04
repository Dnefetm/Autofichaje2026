-- =============================================================================
-- Logística Full — SKU y título del envío (desde el PDF de MeLi)
-- =============================================================================
-- El SKU y el título que MeLi asigna a la publicación en el envío vienen en el
-- PDF de preparación. Se guardan por egreso para mostrarlos al operario, sin
-- depender de la sincronización del catálogo (que puede diferir o estar desfasada).
-- =============================================================================

ALTER TABLE egresos
  ADD COLUMN IF NOT EXISTS sku_ml    text,
  ADD COLUMN IF NOT EXISTS titulo_ml text;
