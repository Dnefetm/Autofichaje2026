-- Migration: 20261121095000_prioridad_sync_stock_mapped.sql
-- Description: Eleva sync_stock_mapped a priority = 1 (detras solo de process_sale = 0, por encima de sync_item = 2)
--              para evitar inanicion de sincronizacion de stock y riesgo de sobreventas.

CREATE OR REPLACE FUNCTION public.fn_encolar_sync_stock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Solo si physical_stock o reserved_stock cambiaron
  IF (NEW.physical_stock IS DISTINCT FROM OLD.physical_stock)
     OR (NEW.reserved_stock IS DISTINCT FROM OLD.reserved_stock) THEN

    INSERT INTO public.jobs (type, payload, status, priority, scheduled_at)
    SELECT 'sync_stock_mapped',
           jsonb_build_object('publicacion_id', pe.id),
           'pending',
           1,
           NOW()
    FROM public.mapeo_publicacion_articulo mpa
    JOIN public.publicaciones_externas pe ON pe.id = mpa.publicacion_id
    WHERE mpa.articulo_id = NEW.sku
      AND pe.es_fuente_stock = true
      AND (pe.sync_disabled IS NOT TRUE OR pe.sync_disabled IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.type = 'sync_stock_mapped'
        AND j.status = 'pending'
        AND j.payload->>'publicacion_id' = pe.id::text
      );
  END IF;
  RETURN NEW;
END;
$function$;

-- Promover los jobs sync_stock_mapped actualmente pendientes de priority 5 -> 1
UPDATE public.jobs
SET priority = 1
WHERE type = 'sync_stock_mapped'
  AND status = 'pending'
  AND priority <> 1;
