-- Emergencia Nivel Máximo: Truncar TODA la data cruda para forzar la liberación de espacio.
-- TRUNCATE a diferencia de DELETE, devuelve el espacio en disco al SO inmediatamente

TRUNCATE TABLE public.listas_precios_raw_staging;
TRUNCATE TABLE public.importaciones_excel CASCADE;
