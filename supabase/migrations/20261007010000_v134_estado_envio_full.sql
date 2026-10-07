-- v134: estado_envio + unidades_full en egresos para reconciliación de envíos Full.
-- "En camino" pasa a ser local (egresos envio_full activos) en vez de MeLi stock_full_total.

-- unidades_full = piezas Full del PDF (por línea inventory_id), para agregar "en camino".
ALTER TABLE public.egresos ADD COLUMN IF NOT EXISTS unidades_full integer;

-- estado_envio: en_camino | recibido | cancelado.
-- Los egresos nuevos (importar-pdf) nacen 'en_camino' (default).
ALTER TABLE public.egresos ADD COLUMN IF NOT EXISTS estado_envio text NOT NULL DEFAULT 'en_camino';

-- Backfill seguro: los egresos envio_full históricos ya fueron recibidos.
-- Así "en camino" arranca en 0 para lo histórico y solo crece con envíos nuevos,
-- evitando doble conteo contra el stock aptas ya sincronizado de MeLi.
UPDATE public.egresos
SET estado_envio = 'recibido'
WHERE tipo_egreso = 'envio_full'
  AND estado_envio = 'en_camino';
