-- v46_comment_marketplace_prices_sku.sql
-- Documenta que marketplace_prices.sku almacena articulo_id, NO el SKU de tienda.
-- Esto sigue el mismo patrón que inventory_snapshot (migración V27).
-- No se renombra la columna para evitar romper consultas existentes.

COMMENT ON COLUMN marketplace_prices.sku IS 'articulo_id del producto (UUID) — NO es el SKU de tienda. Mismo patrón que inventory_snapshot.sku tras migración V27.';
