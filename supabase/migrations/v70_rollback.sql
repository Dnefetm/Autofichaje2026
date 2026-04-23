-- 1. Restaurar la funcion del trigger a su estado anterior
CREATE OR REPLACE FUNCTION fn_disparar_edge_procesar_importacion()
RETURNS TRIGGER AS $$
DECLARE
  edge_url TEXT;
  service_key TEXT;
  req_body JSONB;
BEGIN
  -- Parametros inyectados por ALTER DATABASE SET ...
  edge_url := current_setting('app.settings.edge_url', true);
  service_key := current_setting('app.settings.service_role_key', true);
  
  IF edge_url IS NOT NULL AND service_key IS NOT NULL THEN
     req_body := json_build_object('importacion_id', NEW.id);
     
     PERFORM net.http_post(
         url := edge_url || '/functions/v1/procesar-importacion',
         headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || service_key
         ),
         body := req_body,
         timeout_milliseconds := 10000
     );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Reactivar el watchdog
UPDATE cron.job SET active = true WHERE jobname ILIKE '%watchdog%';
