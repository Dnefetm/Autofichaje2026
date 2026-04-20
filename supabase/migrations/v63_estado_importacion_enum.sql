-- v63: Migración estado_importacion_excel de TEXT+CHECK a ENUM + state machine.
-- Raíz: el CHECK viejo solo permitía {'en_revision', ...}; el código quería insertar
-- 'pendiente_mapeo'. Además, existían 2 vistas (v_importaciones_historial,
-- v_importaciones_panel) y un índice parcial (idx_importaciones_activas) que
-- dependían de la columna, creados ad-hoc vía Studio y nunca versionados en git.
-- Esta migración es idempotente respecto al repo: versiona TODO lo que había suelto.

BEGIN;

-- ============================================================================
-- FASE 1: remover dependencias bloqueantes (todo mientras columna sigue siendo text)
-- ============================================================================

ALTER TABLE importaciones_excel
  DROP CONSTRAINT IF EXISTS importaciones_excel_estado_check;

ALTER TABLE importaciones_excel
  ALTER COLUMN estado DROP DEFAULT;

-- Sanitizar valores huérfanos (ej: 'en_revision') para que el cast a ENUM no falle.
UPDATE importaciones_excel
  SET estado = 'pendiente_mapeo'
  WHERE estado NOT IN
    ('pendiente_mapeo','mapeando','procesando','completado','error','cancelado');

DROP VIEW IF EXISTS v_importaciones_historial;
DROP VIEW IF EXISTS v_importaciones_panel;

-- Índice parcial cuyo predicado comparaba estado contra literales text
-- ('procesando','en_cola','pendiente') - hay que recrearlo con ENUM.
DROP INDEX IF EXISTS idx_importaciones_activas;

-- ============================================================================
-- FASE 2: crear ENUM y migrar la columna
-- ============================================================================

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

ALTER TABLE importaciones_excel
  ALTER COLUMN estado TYPE estado_importacion_excel
  USING estado::estado_importacion_excel;

ALTER TABLE importaciones_excel
  ALTER COLUMN estado SET DEFAULT 'pendiente_mapeo'::estado_importacion_excel;

-- ============================================================================
-- FASE 3a: recrear el índice parcial con valores válidos del ENUM
-- ============================================================================

CREATE INDEX idx_importaciones_activas
  ON public.importaciones_excel
  USING btree (ultima_actividad)
  WHERE (estado IN (
    'procesando'::estado_importacion_excel,
    'mapeando'::estado_importacion_excel,
    'pendiente_mapeo'::estado_importacion_excel
  ));

-- ============================================================================
-- FASE 3b: recrear las 2 vistas dependientes (definiciones extraídas vía
--          pg_get_viewdef desde Supabase; nunca estuvieron en git).
-- ============================================================================

CREATE OR REPLACE VIEW v_importaciones_historial AS
SELECT
  id,
  proveedor,
  nombre_archivo,
  total_filas,
  filas_con_match,
  estado,
  creado_el,
  tipo_costo_default,
  (SELECT count(*) AS count
     FROM listas_precios_raw lpr
     WHERE lpr.importacion_id = ie.id
       AND lpr.revertido_at IS NULL) AS filas_raw_activas,
  (SELECT count(*) AS count
     FROM costos_articulo ca
     WHERE ca.importacion_id = ie.id
       AND ca.vigente) AS costos_vigentes_generados
FROM importaciones_excel ie
ORDER BY creado_el DESC;

CREATE OR REPLACE VIEW v_importaciones_panel AS
SELECT
  id,
  proveedor,
  nombre_archivo,
  estado,
  total_filas,
  filas_procesadas,
  filas_con_match,
  CASE WHEN COALESCE(total_filas, 0) > 0
       THEN round(100.0 * COALESCE(filas_procesadas, 0)::numeric / total_filas::numeric, 1)
       ELSE 0::numeric
  END AS pct_progreso,
  CASE WHEN COALESCE(total_filas, 0) > 0
       THEN round(100.0 * COALESCE(filas_con_match, 0)::numeric / total_filas::numeric, 1)
       ELSE 0::numeric
  END AS pct_match,
  error_mensaje,
  created_at,
  ultima_actividad,
  (SELECT count(*) AS count
     FROM costos_articulo c
     WHERE c.importacion_id = i.id) AS costos_count
FROM importaciones_excel i
ORDER BY created_at DESC;

-- ============================================================================
-- FASE 4: state machine declarativa (tabla de transiciones + trigger validador)
-- ============================================================================

CREATE TABLE IF NOT EXISTS importacion_estado_transiciones (
  desde estado_importacion_excel NOT NULL,
  hasta estado_importacion_excel NOT NULL,
  PRIMARY KEY (desde, hasta)
);

ALTER TABLE importacion_estado_transiciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_transiciones_read ON importacion_estado_transiciones;
CREATE POLICY p_transiciones_read
  ON importacion_estado_transiciones
  FOR SELECT
  USING (false);  -- bloquea clientes anon/authenticated; SECURITY DEFINER lee por dentro.

INSERT INTO importacion_estado_transiciones(desde, hasta) VALUES
  ('pendiente_mapeo', 'mapeando'),
  ('pendiente_mapeo', 'error'),
  ('pendiente_mapeo', 'cancelado'),
  ('mapeando',        'procesando'),
  ('mapeando',        'cancelado'),
  ('mapeando',        'error'),
  ('procesando',      'completado'),
  ('procesando',      'error'),
  ('procesando',      'cancelado'),
  ('completado',      'cancelado'),
  ('error',           'cancelado')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION fn_validar_transicion_estado_importacion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.estado = OLD.estado THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM importacion_estado_transiciones
    WHERE desde = OLD.estado
      AND hasta = NEW.estado
  ) THEN
    RAISE EXCEPTION
      'Transicion invalida de % a % en importaciones_excel id=%',
      OLD.estado, NEW.estado, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validar_transicion_importacion ON importaciones_excel;

CREATE TRIGGER trg_validar_transicion_importacion
  BEFORE UPDATE OF estado ON importaciones_excel
  FOR EACH ROW
  EXECUTE FUNCTION fn_validar_transicion_estado_importacion();

COMMIT;
