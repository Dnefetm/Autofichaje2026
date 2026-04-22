-- v68: Patch ENUM missing 'en_revision'

ALTER TYPE estado_importacion_excel ADD VALUE IF NOT EXISTS 'en_revision' AFTER 'procesando';

INSERT INTO importacion_estado_transiciones(desde, hasta) VALUES
  ('mapeando', 'en_revision'),
  ('en_revision', 'completado'),
  ('en_revision', 'cancelado'),
  ('en_revision', 'error')
ON CONFLICT DO NOTHING;
