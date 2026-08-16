-- Limpieza profunda para liberar espacio
TRUNCATE TABLE public.listas_precios_raw_staging;

-- Eliminar de la tabla raw todo aquello asociado a importaciones fallidas o canceladas
DELETE FROM public.listas_precios_raw 
WHERE importacion_id IN (
    SELECT id FROM public.importaciones_excel 
    WHERE estado IN ('error', 'cancelado')
);

-- Cancelar las que estén estancadas
UPDATE public.importaciones_excel
SET estado = 'cancelado', error_mensaje = 'Cancelada por limpieza de emergencia (limite de bd)'
WHERE estado IN ('procesando', 'mapeando');
