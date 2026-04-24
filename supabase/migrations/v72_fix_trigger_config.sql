-- v72_fix_trigger_config.sql
-- We create a simple config table to store the edge function url and service role key securely
-- since Supabase restricts setting app.settings.* on the free tier without superuser.

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.app_config (
    key text PRIMARY KEY,
    value text NOT NULL
);

-- Note: In production, you would insert the values manually or via a script.
-- For this migration, we ensure the trigger reads from this table.

CREATE OR REPLACE FUNCTION fn_disparar_edge_procesar_importacion()
RETURNS TRIGGER AS $$
DECLARE
  v_edge_url TEXT;
  v_service_key TEXT;
  req_body JSONB;
BEGIN
  -- Intentar obtener de la tabla de configuracion
  SELECT value INTO v_edge_url FROM private.app_config WHERE key = 'edge_url';
  SELECT value INTO v_service_key FROM private.app_config WHERE key = 'service_role_key';
  
  -- Fallback a app.settings si existiera (para compatibilidad)
  IF v_edge_url IS NULL THEN
      v_edge_url := current_setting('app.settings.edge_url', true);
  END IF;
  
  IF v_service_key IS NULL THEN
      v_service_key := current_setting('app.settings.service_role_key', true);
  END IF;
  
  IF v_edge_url IS NOT NULL AND v_service_key IS NOT NULL THEN
     req_body := json_build_object('importacion_id', NEW.id);
     
     PERFORM net.http_post(
         url := v_edge_url || '/procesar-matching',
         headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || v_service_key
         ),
         body := req_body,
         timeout_milliseconds := 10000
     );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
