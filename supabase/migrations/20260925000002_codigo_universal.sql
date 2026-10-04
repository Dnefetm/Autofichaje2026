-- =============================================================================
-- Logística Full — P6b escáner: código universal (UPC) por egreso
-- =============================================================================
-- El operario escanea el código de barras del producto (código universal/UPC)
-- para ubicarlo rápido en el envío. Se guarda por egreso.
-- =============================================================================

ALTER TABLE egresos
  ADD COLUMN IF NOT EXISTS codigo_universal text;
