-- =============================================================================
-- MIGRACIÓN: Estrategia de Autolimpieza Permanente (pg_cron)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE PROCEDURE public.sp_mantenimiento_diario_supabase()
LANGUAGE plpgsql SECURITY DEFINER AS 
BEGIN
    -- 1. Purgar eventos crudos de Mercado Libre (> 7 días)
    -- Libera un promedio de 22MB a la semana.
    DELETE FROM meli_webhook_events WHERE created_at < NOW() - INTERVAL '7 days';

    -- 2. Purgar payloads crudos de Excel (> 3 días)
    -- Esta es la tabla más pesada (185MB). Guardamos el registro de la importación (importaciones_excel),
    -- pero tiramos el JSON pesado de la lista raw después de 72 hrs para evitar colapsar la BD.
    DELETE FROM listas_precios_raw WHERE created_at < NOW() - INTERVAL '3 days';

    -- 3. Purgar jobs completados o fallidos viejos (> 3 días)
    -- Previene tormentas en el worker y libera índices.
    DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '3 days' AND status IN ('completed', 'failed');
    
    -- Si hay jobs en pending estancados por más de 3 días (ej. por bugs de Vercel), borrarlos.
    DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '3 days' AND status = 'pending';

    -- 4. Purgar historial de auditoría de precios (> 15 días)
    DELETE FROM publication_pricing_history WHERE created_at < NOW() - INTERVAL '15 days';

    COMMIT;
END;
;

-- Programar el Job para que corra todos los días a las 2:00 AM.
SELECT cron.schedule('mantenimiento-permanente-supabase', '0 2 * * *', 'CALL public.sp_mantenimiento_diario_supabase()');
