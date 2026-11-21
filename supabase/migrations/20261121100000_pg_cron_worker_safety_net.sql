-- Migration: 20261121100000_pg_cron_worker_safety_net.sql
-- Description: Respaldo autonomo en Supabase (pg_cron + pg_net + Vault) para /api/worker/process.
--              Condicion de parada explicita: si no existen jobs pending listos, termina en <1ms sin llamada HTTP.

CREATE OR REPLACE FUNCTION public.fn_disparar_worker_si_hay_pendientes()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pending_cnt integer;
  v_secret      text;
  v_req_id      bigint;
BEGIN
  -- 1. Condicion de parada explicita: si no hay jobs pending listos, 0 llamadas HTTP a Vercel
  SELECT count(*) INTO v_pending_cnt
  FROM public.jobs
  WHERE status = 'pending'
    AND scheduled_at <= now();

  IF v_pending_cnt = 0 THEN
    RETURN 'SKIP_NO_PENDING_JOBS';
  END IF;

  -- 2. Leer CRON_SECRET cifrado desde Supabase Vault (nunca hardcodeado)
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'vercel_cron_secret'
  LIMIT 1;

  IF v_secret IS NULL OR length(trim(v_secret)) = 0 THEN
    RETURN 'SKIP_MISSING_VAULT_SECRET';
  END IF;

  -- 3. Disparar /api/worker/process de forma asincrona via pg_net
  SELECT net.http_get(
    url := 'https://autofichaje2026-dashboard-1img.vercel.app/api/worker/process',
    headers := jsonb_build_object('Authorization', 'Bearer ' || trim(v_secret)),
    timeout_milliseconds := 5000
  ) INTO v_req_id;

  RETURN 'DISPATCHED_REQ_' || v_req_id::text || '_PENDING_' || v_pending_cnt::text;
END;
$function$;

-- Gate DDL Obligatorio: revocar ejecucion a roles publicos/cliente
REVOKE ALL ON FUNCTION public.fn_disparar_worker_si_hay_pendientes() FROM PUBLIC, anon, authenticated;

-- Programar cron cada 5 minutos (idempotente)
DO $$
DECLARE
  v_existing_jobid bigint;
BEGIN
  SELECT jobid INTO v_existing_jobid
  FROM cron.job
  WHERE jobname = 'worker_jobs_safety_net_5m'
  LIMIT 1;

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'worker_jobs_safety_net_5m',
    '*/5 * * * *',
    'SELECT public.fn_disparar_worker_si_hay_pendientes();'
  );
END $$;
