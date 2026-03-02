-- MIGRATION: Separating Physical Stock from Publication Data

-- 1. Create a View for Calculated Marketplace Publishable Stock
-- This view dynamically calculates the true stock we should push to Mercado Libre.
-- For standard items: available_stock = physical_stock - dropship_stock - reserved_stock
-- For bundles/kits, it will need a more advanced calculation later based on bundle_components.
CREATE OR REPLACE VIEW calculated_publishable_stock AS
SELECT 
    sku,
    physical_stock,
    reserved_stock,
    dropship_stock,
    -- Simple logic for now: Physical - Reserved + Dropship
    -- In a real scenario, this would evaluate the limiting reagent for kits
    GREATEST(0, physical_stock + dropship_stock - reserved_stock) as calculated_available_stock
FROM inventory_snapshot;

-- 2. Prevent `inventory_snapshot` from being deleted when a SKU is deleted (ON DELETE RESTRICT)
-- Re-create the constraint securely.
ALTER TABLE inventory_snapshot DROP CONSTRAINT IF EXISTS inventory_snapshot_sku_fkey;

ALTER TABLE inventory_snapshot
  ADD CONSTRAINT inventory_snapshot_sku_fkey 
  FOREIGN KEY (sku) REFERENCES skus(sku) ON DELETE RESTRICT;

-- 3. Prevent `sku_marketplace_mapping` from being deleted automatically
ALTER TABLE sku_marketplace_mapping DROP CONSTRAINT IF EXISTS sku_marketplace_mapping_sku_fkey;

ALTER TABLE sku_marketplace_mapping
  ADD CONSTRAINT sku_marketplace_mapping_sku_fkey 
  FOREIGN KEY (sku) REFERENCES skus(sku) ON DELETE RESTRICT;

-- 4. Enable Row Level Security (RLS) across all core tables
ALTER TABLE skus ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE sku_marketplace_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_prices ENABLE ROW LEVEL SECURITY;

-- 5. Create default RLS policies
-- 5a. Authenticated Users (e.g. Dashboard access) can READ all
CREATE POLICY "Auth users can read skus" ON skus FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can read mapping" ON sku_marketplace_mapping FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can read snapshot" ON inventory_snapshot FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can read configs" ON marketplace_configs FOR SELECT TO authenticated USING (true);

-- 5b. The Service Role (Worker / API) bypasses these policies automatically, so it can write.
-- The authenticated users will need INSERT/UPDATE policies if they modify from the UI directly via supabase-js.
-- For now we allow authenticated writes:
CREATE POLICY "Auth users can write skus" ON skus FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth users can write mapping" ON sku_marketplace_mapping FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth users can write snapshot" ON inventory_snapshot FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth users can write configs" ON marketplace_configs FOR ALL TO authenticated USING (true) WITH CHECK (true);
