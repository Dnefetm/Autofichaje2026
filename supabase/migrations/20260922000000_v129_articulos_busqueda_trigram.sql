-- v129: índices trigram para búsqueda instantánea por subcadena en articulos
-- ---------------------------------------------------------------------------
-- Problema: la búsqueda del modal de mapeo (y otras superficies: catálogo,
-- autoficha, fichas, alias, ventas) usa ILIKE '%term%' sobre
-- articulo_id / nombre / marca / modelo / variante / codigo_universal.
-- Sin índice trigram, cada pulsación hace un full scan de toda la tabla.
--
-- Solución: índices GIN pg_trgm sobre lower(col) — la forma correcta para
-- ILIKE (insensible a mayúsculas). No se toca el frontend: Postgres usa estos
-- índices automáticamente cuando la query hace ILIKE '%term%'.
--
-- Idempotente (IF NOT EXISTS). No modifica datos ni quita índices existentes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_articulos_nombre_trgm
  ON articulos USING gin (lower(nombre) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articulos_articulo_id_trgm
  ON articulos USING gin (lower(articulo_id) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articulos_marca_trgm
  ON articulos USING gin (lower(marca) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articulos_modelo_trgm
  ON articulos USING gin (lower(modelo) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articulos_codigo_universal_trgm
  ON articulos USING gin (lower(codigo_universal) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articulos_variante_trgm
  ON articulos USING gin (lower(variante) gin_trgm_ops);
