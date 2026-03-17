-- V26 Fase 3: Columnas para visitas persistidas y descripción
-- Ejecutar en Supabase SQL Editor (proyecto ryxdqnzyvnrwalylqyvm)

ALTER TABLE publicaciones_externas
  ADD COLUMN IF NOT EXISTS visits_30d         integer     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS visits_updated_at  timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS description_plain  text        DEFAULT NULL;

-- Índice para filtros/ordenamiento por visitas
CREATE INDEX IF NOT EXISTS idx_pe_visits_30d ON publicaciones_externas (visits_30d DESC NULLS LAST)
  WHERE visits_30d IS NOT NULL;
