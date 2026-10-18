-- 20261021: tabla canónica de catálogo por proveedor (precios + existencias + datos).
-- Una fila por (proveedor, sku_norm). sku_proveedor conserva el literal original.
CREATE TABLE IF NOT EXISTS catalogo_proveedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor text NOT NULL,
  sku_proveedor text NOT NULL,
  sku_norm text NOT NULL,
  codigo_barra text,
  descripcion text,
  marca text,
  codigo_sat text,
  multiplicador_venta integer,
  cantidad_minima integer,
  precio_distribuidor numeric,
  precio_subdistribuidor numeric,
  precio_publico numeric,
  precio_cantidad_minima numeric,
  tipo_costo text,
  stock integer,
  extra jsonb,
  vigente boolean DEFAULT true,
  origen text,
  actualizado_el timestamptz DEFAULT now(),
  UNIQUE (proveedor, sku_norm)
);
CREATE INDEX IF NOT EXISTS ix_catalogo_proveedor_proveedor ON catalogo_proveedor (proveedor);

-- Log ligero de feeds de existencias (auditoría, sin acumular capturas completas).
CREATE TABLE IF NOT EXISTS proveedor_feeds_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor text NOT NULL,
  archivo text,
  filas integer,
  creado_el timestamptz DEFAULT now()
);
