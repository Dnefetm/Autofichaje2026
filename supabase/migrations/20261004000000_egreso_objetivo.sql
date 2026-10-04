-- =============================================================================
-- Logística Full — Objetivo del envío por egreso (cantidad a tomar, desde el PDF)
-- =============================================================================
-- El "Objetivo" (unidades a enviar/tomar) se guardaba en notas, pero las notas
-- son para apuntes libres del operario. Se separa a una columna propia.
-- =============================================================================

ALTER TABLE egresos
  ADD COLUMN IF NOT EXISTS objetivo integer;
