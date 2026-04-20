-- 1) Crear el tipo ENUM una sola vez (fuente de verdad)
DO $$ BEGIN
  CREATE TYPE estado_importacion_excel AS ENUM (
    'pendiente_mapeo',
    'mapeando',
    'procesando',
    'completado',
    'error',
    'cancelado'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Migrar la columna de TEXT+CHECK a ENUM

-- 2a) Sanitizar datos incompatibles viejos (como subiendo, en_cola, etc.)
UPDATE importaciones_excel 
  SET estado = 'pendiente_mapeo' 
  WHERE estado NOT IN ('pendiente_mapeo','mapeando','procesando','completado','error','cancelado');

ALTER TABLE importaciones_excel
  DROP CONSTRAINT IF EXISTS importaciones_excel_estado_check;

ALTER TABLE importaciones_excel
  ALTER COLUMN estado DROP DEFAULT;

ALTER TABLE importaciones_excel
  ALTER COLUMN estado TYPE estado_importacion_excel
  USING estado::estado_importacion_excel;

ALTER TABLE importaciones_excel
  ALTER COLUMN estado SET DEFAULT 'pendiente_mapeo'::estado_importacion_excel;

-- 3) Tabla de transiciones válidas (state machine declarativa)
CREATE TABLE IF NOT EXISTS importacion_estado_transiciones (
  desde estado_importacion_excel NOT NULL,
  hasta estado_importacion_excel NOT NULL,
  PRIMARY KEY (desde, hasta)
);

INSERT INTO importacion_estado_transiciones(desde, hasta) VALUES
  ('pendiente_mapeo', 'mapeando'),   
  ('pendiente_mapeo', 'error'),    
  ('pendiente_mapeo', 'cancelado'),
  
  ('mapeando', 'procesando'),
  ('mapeando', 'cancelado'),
  ('mapeando', 'error'),
  
  ('procesando', 'completado'),
  ('procesando', 'error'),
  ('procesando', 'cancelado'),

  ('completado', 'cancelado'),
  ('error', 'cancelado')
ON CONFLICT DO NOTHING;

-- 4) Trigger que bloquea transiciones inválidas
CREATE OR REPLACE FUNCTION fn_validar_transicion_estado_importacion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM importacion_estado_transiciones
    WHERE desde = OLD.estado AND hasta = NEW.estado
  ) THEN
    RAISE EXCEPTION 'Transición inválida de % a % en importaciones_excel id=%',
      OLD.estado, NEW.estado, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validar_transicion_importacion ON importaciones_excel;
CREATE TRIGGER trg_validar_transicion_importacion
  BEFORE UPDATE OF estado ON importaciones_excel
  FOR EACH ROW EXECUTE FUNCTION fn_validar_transicion_estado_importacion();
