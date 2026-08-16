-- 1. EMERGENCIA: Liberar espacio en disco truncando las tablas de staging
--    (Esto solucionara el error de "tamaño maximo de la base de datos superado")
TRUNCATE TABLE public.listas_precios_raw_staging;

-- 2. Asegurarnos que los indices unicos coincidan EXACTAMENTE con lo que el RPC espera
DROP INDEX IF EXISTS public.ux_costos_pendientes_resuelto;
CREATE UNIQUE INDEX ux_costos_pendientes_resuelto 
ON public.costos_pendientes (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo) 
WHERE resuelto = false;

DROP INDEX IF EXISTS public.ux_costos_articulo_fuente;
DROP INDEX IF EXISTS public.ux_costos_articulo_unico;
CREATE UNIQUE INDEX ux_costos_articulo_unico 
ON public.costos_articulo (articulo_id, tipo_costo, fuente);

-- 3. Limpiar importaciones atascadas
UPDATE public.importaciones_excel
SET estado = 'error',
    error_mensaje = 'Fallo por limite de tamaño de BD y error de constraint. (Limpiado)'
WHERE estado IN ('procesando', 'mapeando');
