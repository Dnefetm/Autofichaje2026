-- v60: Fix importaciones_excel estado check constraint
-- Add 'pendiente_mapeo' to allowed values for the pricing import pipeline

ALTER TABLE importaciones_excel DROP CONSTRAINT importaciones_excel_estado_check;

ALTER TABLE importaciones_excel ADD CONSTRAINT importaciones_excel_estado_check
  CHECK (estado = ANY (ARRAY[
    'pendiente'::text,
    'pendiente_mapeo'::text,
    'procesando'::text,
    'procesado'::text,
    'error'::text
  ]));
