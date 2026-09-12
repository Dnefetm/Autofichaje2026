-- =============================================================================
-- Fase 0.2 — Endurecimiento de ventas a subdistribuidores
-- =============================================================================
-- UNIQUE sobre clientes.nombre (sin mayúsculas y sin espacios laterales) para
-- impedir clientes duplicados.
-- NOTA: si ya existen clientes con el mismo nombre, esta migración fallará;
-- en ese caso, deduplicar los datos primero y volver a correr.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_nombre_lower
  ON clientes (lower(btrim(nombre)));
