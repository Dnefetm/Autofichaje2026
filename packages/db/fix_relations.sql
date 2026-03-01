-- 1. Crear las tablas principales en caso de que aún no se hayan ejecutado en producción
CREATE TABLE IF NOT EXISTS inventory_snapshot (
    sku TEXT PRIMARY KEY REFERENCES skus(sku) ON DELETE CASCADE,
    physical_stock INTEGER DEFAULT 0,
    dropship_stock INTEGER DEFAULT 0,
    reserved_stock INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sku_marketplace_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT REFERENCES skus(sku) ON DELETE CASCADE,
    marketplace_id UUID REFERENCES marketplace_configs(id),
    external_item_id TEXT NOT NULL,
    external_variation_id TEXT,
    sync_status TEXT DEFAULT 'active',
    last_sync_at TIMESTAMPTZ,
    UNIQUE(sku, marketplace_id, external_variation_id)
);

-- 2. Agregar la relación (Foreign Key) explícita requerida por PostgREST
-- Sin esto, el cliente de Supabase no puede hacer un JOIN directo (select="..., inventory_snapshot(...)")
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_smm_inv_snapshot'
    ) THEN
        ALTER TABLE sku_marketplace_mapping 
        ADD CONSTRAINT fk_smm_inv_snapshot 
        FOREIGN KEY (sku) REFERENCES inventory_snapshot(sku) ON DELETE CASCADE;
    END IF;
END $$;
