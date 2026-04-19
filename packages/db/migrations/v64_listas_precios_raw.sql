CREATE TABLE IF NOT EXISTS listas_precios_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacion_id uuid NOT NULL REFERENCES importaciones_excel(id) ON DELETE CASCADE,
  proveedor_id uuid NOT NULL REFERENCES proveedores(id),
  fila_num int NOT NULL,
  payload jsonb NOT NULL,
  columnas_guardadas text[] NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lpr_importacion ON listas_precios_raw(importacion_id);
CREATE INDEX IF NOT EXISTS idx_lpr_proveedor ON listas_precios_raw(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_lpr_payload_gin ON listas_precios_raw USING gin(payload);

GRANT SELECT, INSERT, DELETE, UPDATE ON listas_precios_raw TO authenticated, service_role;
