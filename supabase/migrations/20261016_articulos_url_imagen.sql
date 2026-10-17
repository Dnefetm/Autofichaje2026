-- 20261016: columna url_imagen en articulos (para guardar la foto del proveedor, p.ej. DAI)
ALTER TABLE public.articulos ADD COLUMN IF NOT EXISTS url_imagen text;
