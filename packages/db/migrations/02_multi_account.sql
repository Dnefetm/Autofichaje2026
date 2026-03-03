-- Migración para soportar múltiples cuentas por Mercado (Ej. 2 cuentas de Mercado Libre)
-- Eliminamos ambas restricciones de unicidad sobre la tabla configs, excepto el ID principal.
-- Esto permite que coexistan múltiples filas idénticas en Marketplace, diferenciadas por el account_name.

ALTER TABLE marketplace_configs DROP CONSTRAINT IF EXISTS marketplace_configs_marketplace_key;
ALTER TABLE marketplace_configs DROP CONSTRAINT IF EXISTS marketplace_configs_marketplace_account_name_key;

-- Aplicamos la única restricción lógica: No deberías nombrar a dos cuentas de MeLi exactamente igual.
ALTER TABLE marketplace_configs ADD CONSTRAINT marketplace_configs_marketplace_account_name_key UNIQUE (marketplace, account_name);
