-- v47b_fix_marketplace_prices_constraints.sql
-- Corrección post-v47: articulo_id quedó nullable y sin FK explícita.
-- El RENAME COLUMN no transfirió el constraint de la columna original.
-- Corregido aquí con NOT NULL + FK explícita.

ALTER TABLE marketplace_prices
  ALTER COLUMN articulo_id SET NOT NULL;

ALTER TABLE marketplace_prices
  ADD CONSTRAINT fk_marketplace_prices_articulo
  FOREIGN KEY (articulo_id) REFERENCES articulos(articulo_id) ON DELETE CASCADE;
