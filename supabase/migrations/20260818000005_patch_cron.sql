-- =============================================================================
-- MIGRACIÓN: Parche al Cron de Limpieza
-- =============================================================================

CREATE OR REPLACE PROCEDURE public.sp_mantenimiento_diario_supabase()
LANGUAGE plpgsql SECURITY DEFINER AS 
$$
BEGIN
    DELETE FROM meli_webhook_events WHERE created_at < NOW() - INTERVAL '7 days';

    -- PARCHE: Nunca borrar la lista_precios_raw si está VIGENTE, sin importar la fecha.
    DELETE FROM listas_precios_raw 
    WHERE created_at < NOW() - INTERVAL '6 hours'
    AND importacion_id NOT IN (
        SELECT importacion_id FROM listas_precios_proveedor WHERE vigente = true
    );

    DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '3 days' AND status IN ('completed', 'failed');
    DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '3 days' AND status = 'pending';
    DELETE FROM publication_pricing_history WHERE created_at < NOW() - INTERVAL '15 days';

    COMMIT;
END;
$$;
