-- v74: Índices trigram para acelerar la búsqueda por texto en el catálogo.
-- El modal de mapeo y el buscador usan ILIKE '%…%' (comodín inicial), que sin
-- índices trigram obliga a Postgres a hacer un barrido secuencial de `articulos`
-- (8k+ filas y creciendo). Con pg_trgm estos índices GIN hacen la búsqueda indexada.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_articulos_nombre_trgm
  ON articulos USING gin (nombre gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articulos_articulo_id_trgm
  ON articulos USING gin (articulo_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articulos_marca_trgm
  ON articulos USING gin (marca gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articulos_modelo_trgm
  ON articulos USING gin (modelo gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articulos_codigo_universal_trgm
  ON articulos USING gin (codigo_universal gin_trgm_ops);

-- La variante se busca en el modal también; por si crece.
CREATE INDEX IF NOT EXISTS idx_articulos_variante_trgm
  ON articulos USING gin (variante gin_trgm_ops);
