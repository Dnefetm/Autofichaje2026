-- 1) Crear el tipo ENUM una sola vez (fuente de verdad)
DO $$ BEGIN
  CREATE TYPE importacion_estado AS ENUM (
    'subiendo',         -- presigned URL emitida, archivo aún no en Storage
    'pendiente',        -- archivo en Storage, esperando worker
    'procesando',       -- edge function parseando XLSX
    'mapeo_listo',      -- filas parseadas, UI Paso 2 habilitado
    'matching',         -- corriendo fn_match_articulo_proveedor
    'revision',         -- UI Paso 3, usuario resolviendo dudas
    'confirmada',       -- usuario aceptó, upsert en costos_articulo hecho
    'cancelada',        -- usuario descartó
    'error'             -- falla irrecuperable
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Migrar la columna de TEXT+CHECK a ENUM
ALTER TABLE importaciones_excel
  DROP CONSTRAINT IF EXISTS importaciones_excel_estado_check;

ALTER TABLE importaciones_excel
  ALTER COLUMN estado TYPE importacion_estado
  USING estado::importacion_estado;

ALTER TABLE importaciones_excel
  ALTER COLUMN estado SET DEFAULT 'subiendo'::importacion_estado;

-- 3) Tabla de transiciones válidas (state machine declarativa)
CREATE TABLE IF NOT EXISTS importacion_estado_transiciones (
  desde importacion_estado NOT NULL,
  hasta importacion_estado NOT NULL,
  PRIMARY KEY (desde, hasta)
);

INSERT INTO importacion_estado_transiciones(desde, hasta) VALUES
  ('subiendo',    'pendiente'),   ('subiendo',    'error'),    ('subiendo',    'cancelada'),
  ('pendiente',   'procesando'),  ('pendiente',   'cancelada'),('pendiente',   'error'),
  ('procesando',  'mapeo_listo'), ('procesando',  'error'),
  ('mapeo_listo', 'matching'),    ('mapeo_listo', 'cancelada'),
  ('matching',    'revision'),    ('matching',    'error'),
  ('revision',    'confirmada'),  ('revision',    'cancelada'),
  ('confirmada',  'cancelada')    -- para rollback / revert del batch
ON CONFLICT DO NOTHING;

-- 4) Trigger que bloquea transiciones inválidas
CREATE OR REPLACE FUNCTION fn_validar_transicion_importacion()
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
  FOR EACH ROW EXECUTE FUNCTION fn_validar_transicion_importacion();

-- 5) Índice parcial para que el worker levante pendientes eficientemente
CREATE INDEX IF NOT EXISTS idx_importaciones_excel_pendientes
  ON importaciones_excel(created_at)
  WHERE estado IN ('pendiente', 'procesando');
