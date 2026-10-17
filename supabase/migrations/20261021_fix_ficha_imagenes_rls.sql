-- 20261021: permitir lectura pública de ficha_imagenes.
-- ficha_imagenes tenía RLS habilitado SIN política de SELECT, por lo que el
-- cliente del navegador no podía leer las imágenes (incluidas las 360) anidadas
-- en fichas_tecnicas → no se visualizaban en la ficha del artículo ni en el
-- publicador. Las URLs ya son públicas en Storage, así que se permite SELECT.
DROP POLICY IF EXISTS "Public read ficha_imagenes" ON public.ficha_imagenes;
CREATE POLICY "Public read ficha_imagenes" ON public.ficha_imagenes FOR SELECT USING (true);
