-- 20261021: campos de clasificación independientes por proveedor.
-- categoria1 y categoria2 son DOS dimensiones paralelas (no jerárquicas).
-- Ej. Tuk: categoria1 = FAMILIA, categoria2 = TIPO.

ALTER TABLE public.precios_proveedor
  ADD COLUMN IF NOT EXISTS categoria1 text,
  ADD COLUMN IF NOT EXISTS categoria2 text;

ALTER TABLE public.catalogo_proveedor
  ADD COLUMN IF NOT EXISTS categoria1 text,
  ADD COLUMN IF NOT EXISTS categoria2 text;
