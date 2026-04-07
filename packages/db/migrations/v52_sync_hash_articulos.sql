-- v52_sync_hash_articulos.sql
-- Agrega columna sync_hash a la tabla articulos.
-- Permite que sincArticulos.gs V2 (y pushArticulos.gs) detecten cambios
-- sin hacer UPSERT de todas las filas cada vez.
--
-- Patrón idéntico al usado en ingresos y egresos.

ALTER TABLE articulos
  ADD COLUMN IF NOT EXISTS sync_hash TEXT;

-- Índice para acelerar los lookups por articulo_id al consultar hashes
-- (articulo_id ya es PK, no necesita índice extra; sync_hash sí se puede indexar
--  si en el futuro se consulta directo, pero no es necesario por ahora)

COMMENT ON COLUMN articulos.sync_hash IS
  'Hash MD5 calculado por sincArticulos.gs sobre los campos clave del artículo. '
  'Permite skip de UPSERT cuando el artículo no cambió, evitando disparar triggers '
  'y consumir cuota de Apps Script innecesariamente.';
