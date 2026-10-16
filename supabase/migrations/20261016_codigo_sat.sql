-- 20261016: importador multipropósito — Código SAT + encabezado configurable
-- El Código SAT (ClaveProdServ) es necesario para todos los productos (CFDI),
-- aunque algunos aún no lo tengan → columna nullable.

ALTER TABLE public.precios_proveedor
  ADD COLUMN IF NOT EXISTS codigo_sat text;

ALTER TABLE public.articulos
  ADD COLUMN IF NOT EXISTS codigo_sat text;

COMMENT ON COLUMN public.precios_proveedor.codigo_sat IS 'Clave de producto/servicio SAT (CFDI). NULL = aún no asignada.';
COMMENT ON COLUMN public.articulos.codigo_sat IS 'Clave de producto/servicio SAT (CFDI). NULL = aún no asignada.';
