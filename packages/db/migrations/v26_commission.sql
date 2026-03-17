-- V26 Fase 2: Columnas para comisión real calculada
-- Ejecutar en Supabase SQL Editor (proyecto ryxdqnzyvnrwalylqyvm)

ALTER TABLE publicaciones_externas
  ADD COLUMN IF NOT EXISTS comision_porcentaje numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS comision_monto      numeric DEFAULT NULL;

COMMENT ON COLUMN publicaciones_externas.comision_porcentaje IS 'Porcentaje real de comisión MeLi (e.g. 15.5)';
COMMENT ON COLUMN publicaciones_externas.comision_monto IS 'Monto de comisión en moneda local';
