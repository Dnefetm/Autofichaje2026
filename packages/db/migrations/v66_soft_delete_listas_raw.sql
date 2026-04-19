ALTER TABLE listas_precios_raw
  ADD COLUMN IF NOT EXISTS revertido_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_lpr_vigentes
  ON listas_precios_raw(proveedor_id)
  WHERE revertido_at IS NULL;

COMMENT ON COLUMN listas_precios_raw.revertido_at IS
  'Marca de tiempo de reversión del batch. NULL = vigente. NOT NULL = fila histórica revertida, se conserva como evidencia pero no aparece en consultas por default.';
