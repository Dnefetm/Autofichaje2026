-- ============================================================================
-- v65 FINAL CONSOLIDADO (Reemplaza y unifica v64 y v65 fallida)
-- Pipeline de Precios: Desacople Total (Listas Proveedor + Matching Jobs + Watchdog)
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ESTRUCTURAS BASE (Si faltaban)
-- ----------------------------------------------------------------------------

-- A) Tabla: listas_precios_proveedor (El objetivo final del Paso 3)
CREATE TABLE IF NOT EXISTS listas_precios_proveedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor TEXT NOT NULL,
  importacion_id UUID NOT NULL REFERENCES importaciones_excel(id) ON DELETE CASCADE,
  vigente BOOLEAN NOT NULL DEFAULT false,
  fecha_vigor_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vigor_hasta DATE,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por UUID REFERENCES auth.users(id),
  total_filas INT NOT NULL DEFAULT 0,
  archivo_original_path TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_listas_precios_vigente_por_proveedor 
  ON listas_precios_proveedor(proveedor) WHERE vigente = true;

-- B) Asegurar columnas en importaciones_excel que el frontend/worker esperan
ALTER TABLE importaciones_excel
  ADD COLUMN IF NOT EXISTS error_mensaje TEXT,
  ADD COLUMN IF NOT EXISTS ultima_actividad TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS watchdog_reintentos INT DEFAULT 0;

-- C) ENUM y Tabla para Matching Jobs
DO $$ BEGIN
  CREATE TYPE matching_job_estado AS ENUM ('pendiente', 'corriendo', 'completado', 'error', 'cancelado');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS matching_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lista_precios_id UUID NOT NULL REFERENCES listas_precios_proveedor(id) ON DELETE CASCADE,
  importacion_id UUID NOT NULL REFERENCES importaciones_excel(id) ON DELETE CASCADE,
  estado matching_job_estado NOT NULL DEFAULT 'pendiente',
  progreso INT NOT NULL DEFAULT 0,
  total INT NOT NULL DEFAULT 0,
  error TEXT,
  iniciado_el TIMESTAMPTZ,
  finalizado_el TIMESTAMPTZ,
  creado_el TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por UUID REFERENCES auth.users(id)
);

-- D) Tabla Matching Resultados (Para separar del catalogo oficial costos_articulo)
CREATE TABLE IF NOT EXISTS matching_resultados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matching_job_id UUID NOT NULL REFERENCES matching_jobs(id) ON DELETE CASCADE,
  importacion_id UUID NOT NULL,
  fila_excel_index INT NOT NULL,
  modelo_excel TEXT,
  marca_excel TEXT,
  codigo_excel TEXT,
  candidatos_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,
  puntaje_maximo NUMERIC,
  estado_match TEXT NOT NULL,
  aplicado BOOLEAN NOT NULL DEFAULT false,
  creado_el TIMESTAMPTZ DEFAULT now()
);

-- E) Faltante en máquina de estados: Transicion reversa por el Watchdog
INSERT INTO importacion_estado_transiciones (desde, hasta) VALUES 
('mapeando', 'pendiente_mapeo'),
('cancelado', 'pendiente_mapeo'),
('error', 'pendiente_mapeo')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. PIPELINE DE INGESTA (Staging + Log Eventos)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listas_precios_raw_staging (
  importacion_id UUID NOT NULL REFERENCES importaciones_excel(id) ON DELETE CASCADE,
  proveedor TEXT NOT NULL,
  fila_num INT NOT NULL,
  payload JSONB NOT NULL,
  columnas_guardadas TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (importacion_id, fila_num)
);

CREATE TABLE IF NOT EXISTS importacion_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  importacion_id UUID NOT NULL REFERENCES importaciones_excel(id) ON DELETE CASCADE,
  estado_paso TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  payload_jsonb JSONB,
  creado_el TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_importacion_eventos_importacion_id 
  ON importacion_eventos (importacion_id, creado_el DESC);

-- ----------------------------------------------------------------------------
-- 3. FUNCIONES DE BASE DE DATOS (Trigger Edge + Consolidación Atómica + Watchdog)
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

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
         timeout_milliseconds := 10000 -- Elevado a 10s para estabilizar cold starts
     );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_disparar_worker_importacion ON importaciones_excel;
CREATE TRIGGER trg_disparar_worker_importacion
  AFTER UPDATE OF estado ON importaciones_excel
  FOR EACH ROW
  WHEN (NEW.estado = 'mapeando'::estado_importacion_excel AND OLD.estado = 'pendiente_mapeo'::estado_importacion_excel)
  EXECUTE FUNCTION fn_disparar_edge_procesar_importacion();


CREATE OR REPLACE FUNCTION fn_consolidar_importacion(p_importacion_id UUID, p_proveedor TEXT)
RETURNS void AS $$
BEGIN
  -- Bypass para las foreign keys/constraints temporales si es necesario
  SET LOCAL session_replication_role = 'replica';

  DELETE FROM listas_precios_raw WHERE importacion_id = p_importacion_id;
  
  INSERT INTO listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
  SELECT importacion_id, proveedor, fila_num, payload, columnas_guardadas
  FROM listas_precios_raw_staging 
  WHERE importacion_id = p_importacion_id;

  DELETE FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

  UPDATE listas_precios_proveedor 
  SET vigente = false 
  WHERE proveedor = p_proveedor AND vigente = true;

  INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
  VALUES (
     p_proveedor, p_importacion_id, true, 
     (SELECT COUNT(*) FROM listas_precios_raw WHERE importacion_id = p_importacion_id)
  );

  SET LOCAL session_replication_role = 'origin';

  UPDATE importaciones_excel 
  SET estado = 'completado'::estado_importacion_excel, ultima_actividad = now()
  WHERE id = p_importacion_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE OR REPLACE FUNCTION fn_watchdog_importaciones()
RETURNS void AS $$
DECLARE
  rec RECORD;
BEGIN
  -- Identificar imports trabados
  FOR rec IN 
    SELECT id, watchdog_reintentos 
    FROM importaciones_excel 
    WHERE estado = 'mapeando'::estado_importacion_excel 
      AND (
          (heartbeat_at < now() - interval '2 minutes') 
          OR 
          (heartbeat_at IS NULL AND ultima_actividad < now() - interval '3 minutes')
      )
  LOOP
    IF rec.watchdog_reintentos < 3 THEN
       -- Bypass transiciones temporalmente
       SET LOCAL session_replication_role = 'replica';
       
       UPDATE importaciones_excel 
       SET watchdog_reintentos = watchdog_reintentos + 1,
           estado = 'pendiente_mapeo'::estado_importacion_excel,
           ultima_actividad = now()
       WHERE id = rec.id;
       
       -- Reactivar gatillo pasándolo a mapeando otra vez
       UPDATE importaciones_excel 
       SET estado = 'mapeando'::estado_importacion_excel
       WHERE id = rec.id;
       
       SET LOCAL session_replication_role = 'origin';

       INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
       VALUES (rec.id, 'REINTENTO_WATCHDOG', 'Timeout de Edge detectado. Watchdog ejecutando intento ' || (rec.watchdog_reintentos + 1)::text);
       
    ELSE
       -- Bypass constraints y matar
       SET LOCAL session_replication_role = 'replica';
       UPDATE importaciones_excel 
       SET estado = 'error'::estado_importacion_excel,
           error_mensaje = 'Watchdog abortó el procesamiento: 3 intentos fallidos por timeout asíncrono.',
           ultima_actividad = now()
       WHERE id = rec.id;
       SET LOCAL session_replication_role = 'origin';
       
       INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
       VALUES (rec.id, 'ERROR_FATAL', 'Importación abortada. Worker colgado tras 3 intentos.');
       
       -- Purgar huerfanos del staging
       DELETE FROM listas_precios_raw_staging WHERE importacion_id = rec.id;
    END IF;
  END LOOP;
  
  -- Cron rutinal basurero
  DELETE FROM listas_precios_raw_staging WHERE created_at < now() - interval '7 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reiniciar el schedule del cron por si acaso
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'watchdog-importaciones') THEN
    PERFORM cron.unschedule('watchdog-importaciones');
  END IF;
  PERFORM cron.schedule('watchdog-importaciones', '* * * * *', 'SELECT fn_watchdog_importaciones()');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

COMMIT;
