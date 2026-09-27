-- v131: índices para acelerar la carga y el filtrado de la lista de vitrinas.
-- La lista ordena por creado_el/actualizado_el y filtra por status_externo y
-- marketplace_id; sin índices, la query hace sort/scan sobre toda la tabla.

CREATE INDEX IF NOT EXISTS idx_pe_status_externo
  ON publicaciones_externas (status_externo);

CREATE INDEX IF NOT EXISTS idx_pe_creado_el
  ON publicaciones_externas (creado_el DESC);

CREATE INDEX IF NOT EXISTS idx_pe_actualizado_el
  ON publicaciones_externas (actualizado_el DESC);

CREATE INDEX IF NOT EXISTS idx_pe_marketplace_id
  ON publicaciones_externas (marketplace_id);

-- Compuesto para el patrón más común: filtrar por estado y ordenar por fecha.
CREATE INDEX IF NOT EXISTS idx_pe_status_creado
  ON publicaciones_externas (status_externo, creado_el DESC);
