-- v47_rename_marketplace_prices_sku.sql
-- Renombrar marketplace_prices.sku → articulo_id
-- La columna siempre almacenó el articulo_id (UUID FK a articulos).
-- El nombre 'sku' era incorrecto — sku es para el SKU de tienda.
-- Verificado: 1 fila existente, preservada automáticamente por Postgres.
--
-- También se agrega columna sku_tienda (TEXT) para el SKU de tienda,
-- que en principio será igual a articulo.modelo.

ALTER TABLE marketplace_prices RENAME COLUMN sku TO articulo_id;

ALTER TABLE marketplace_prices ADD COLUMN sku_tienda TEXT;
