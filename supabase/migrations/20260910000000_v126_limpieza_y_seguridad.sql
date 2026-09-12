-- =============================================================================
-- v126: Limpieza permanente + cierre del agujero de seguridad
-- =============================================================================
-- 1) ELIMINA las funciones de SQL arbitrario expuestas en public (agujero critico).
-- 2) Deja ordenes.raw_json nullable para poder liberar TOAST en el futuro.
-- 3) Agrega purga de costos_pendientes resueltos (antes solo se marcaba resuelto).
-- 4) Reescribe el mantenimiento diario aislando cada paso (un fallo no detiene el resto).
-- 5) (Re)programa el cron diario.
--
-- COMO APLICARLO: copia y pega en Supabase Dashboard -> SQL Editor.
-- NO usar `supabase db push`: el historial de migraciones de este proyecto
-- esta inconsistente (mezcla ad-hoc via exec_sql), y un push podria re-aplicar
-- migraciones viejas y fallar.
-- =============================================================================

-- 1) Cerrar agujero de seguridad: quitar TODAS las firmas de exec_sql/exec_sql_json
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('exec_sql', 'exec_sql_json')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig || ' CASCADE';
    RAISE NOTICE 'Eliminada funcion: %', r.sig;
  END LOOP;
END $$;

-- 2) Permitir NULL en raw_json (hoy es NOT NULL)
ALTER TABLE public.ordenes ALTER COLUMN raw_json DROP NOT NULL;

-- 3) Purga de costos_pendientes ya resueltos
CREATE OR REPLACE FUNCTION public.fn_purga_costos_pendientes_resueltos()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_deleted bigint := 0;
BEGIN
  DELETE FROM public.costos_pendientes
  WHERE resuelto = true
    AND resuelto_en < now() - interval '7 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- 4) Mantenimiento diario robusto
CREATE OR REPLACE PROCEDURE public.sp_mantenimiento_diario_supabase()
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  BEGIN
    UPDATE public.ordenes SET raw_json = NULL
    WHERE date_closed IS NOT NULL AND date_closed < now() - interval '30 days';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'ordenes.raw_json: %', SQLERRM; END;

  BEGIN
    DELETE FROM public.listas_precios_raw lpr
    USING public.importaciones_excel i
    WHERE lpr.importacion_id = i.id
      AND i.estado IN ('completado','error','cancelado');
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'listas_precios_raw (terminales): %', SQLERRM; END;

  BEGIN
    DELETE FROM public.listas_precios_raw WHERE created_at < now() - interval '7 days';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'listas_precios_raw (backstop): %', SQLERRM; END;

  BEGIN
    DELETE FROM public.meli_webhook_events WHERE received_at < now() - interval '7 days';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'meli_webhook_events: %', SQLERRM; END;

  BEGIN
    DELETE FROM public.publication_pricing_history WHERE created_at < now() - interval '15 days';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'publication_pricing_history: %', SQLERRM; END;

  BEGIN
    PERFORM public.fn_purga_costos_pendientes_resueltos();
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'costos_pendientes: %', SQLERRM; END;

  BEGIN
    DELETE FROM public.sync_logs WHERE created_at < now() - interval '7 days';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'sync_logs: %', SQLERRM; END;

  BEGIN
    DELETE FROM public.webhook_buffer
    WHERE status = 'done' AND last_processed_at < now() - interval '7 days';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'webhook_buffer: %', SQLERRM; END;

  BEGIN
    DELETE FROM public.jobs
    WHERE status IN ('completed','failed') AND created_at < now() - interval '3 days';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'jobs: %', SQLERRM; END;

  BEGIN
    DELETE FROM public.matching_decisiones md
    USING public.importaciones_excel i
    WHERE md.importacion_id = i.id
      AND i.estado IN ('completado','error','cancelado');
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'matching_decisiones: %', SQLERRM; END;

  BEGIN
    DELETE FROM cron.job_run_details WHERE start_time < now() - interval '30 days';
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'cron.job_run_details: %', SQLERRM; END;
END;
$$;

-- 5) (Re)programar el cron diario a las 02:00 UTC
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mantenimiento-permanente-supabase') THEN
    PERFORM cron.unschedule('mantenimiento-permanente-supabase');
  END IF;
END $$;

SELECT cron.schedule(
  'mantenimiento-permanente-supabase',
  '0 2 * * *',
  'CALL public.sp_mantenimiento_diario_supabase()'
);
