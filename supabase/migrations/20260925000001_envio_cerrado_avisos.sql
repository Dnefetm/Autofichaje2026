-- =============================================================================
-- Logística Full — P2 estado "Cerrado" + P4 avisos de ML
-- =============================================================================
-- P2: el supervisor cierra el envío (edo_reunido = 'Cerrado' + fecha_cerrado).
-- P4: los 4 avisos de ML (etiquetar, frágil, vencimiento, peso/medidas) se
--     guardan por egreso en un JSONB para mostrarlos al operario.
-- =============================================================================

ALTER TABLE egresos
  ADD COLUMN IF NOT EXISTS fecha_cerrado timestamptz,
  ADD COLUMN IF NOT EXISTS avisos jsonb;
