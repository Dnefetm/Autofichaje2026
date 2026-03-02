-- Migration: Update constraints for Multi-Account and Multi-Listing support

-- 1. Remove the strict UNIQUE constraint from marketplace_configs that limits one account per marketplace type
-- Note: In Postgres, if a constraint was created without a name (just using UNIQUE keyword inline), 
-- it automatically generates a name like 'marketplace_configs_marketplace_key'.
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint c 
        JOIN pg_class t ON c.conrelid = t.oid 
        WHERE t.relname = 'marketplace_configs' AND c.conname = 'marketplace_configs_marketplace_key'
    ) THEN
        ALTER TABLE marketplace_configs DROP CONSTRAINT marketplace_configs_marketplace_key;
    END IF;
END $$;

-- Add a new constraint that ensures account_name is unique per marketplace type 
-- (e.g., 'meli' 'Grupo Histo', 'meli' 'Test Account')
ALTER TABLE marketplace_configs ADD CONSTRAINT unique_marketplace_account UNIQUE (marketplace, account_name);

-- 2. Modify sku_marketplace_mapping constraints
-- The original table had: UNIQUE(sku, marketplace_id, external_variation_id)
-- This prevents the SAME SKU from having multiple different external POSTS (listings) on the same account 
-- if they don't have variations (which is very common).
DO $$ 
BEGIN
    -- Drop the restrictive constraint
    IF EXISTS (
        SELECT 1 FROM pg_constraint c 
        JOIN pg_class t ON c.conrelid = t.oid 
        WHERE t.relname = 'sku_marketplace_mapping' AND c.conname = 'sku_marketplace_mapping_sku_marketplace_id_external_vari_key'
    ) THEN
        ALTER TABLE sku_marketplace_mapping DROP CONSTRAINT sku_marketplace_mapping_sku_marketplace_id_external_vari_key;
    END IF;
END $$;

-- The truth is, the most critical uniqueness we care about is that an external listing 
-- in a specific account should NOT be mapped twice.
ALTER TABLE sku_marketplace_mapping ADD CONSTRAINT unique_external_listing UNIQUE (marketplace_id, external_item_id, external_variation_id);
