-- FIX: Grant 'anon' access to the core tables since the dashboard currently uses the anon key without a login system.

-- Update skus policies
DROP POLICY IF EXISTS "Auth users can read skus" ON skus;
DROP POLICY IF EXISTS "Auth users can write skus" ON skus;
CREATE POLICY "Public users can read skus" ON skus FOR SELECT TO public USING (true);
CREATE POLICY "Public users can write skus" ON skus FOR ALL TO public USING (true) WITH CHECK (true);

-- Update sku_marketplace_mapping policies
DROP POLICY IF EXISTS "Auth users can read mapping" ON sku_marketplace_mapping;
DROP POLICY IF EXISTS "Auth users can write mapping" ON sku_marketplace_mapping;
CREATE POLICY "Public users can read mapping" ON sku_marketplace_mapping FOR SELECT TO public USING (true);
CREATE POLICY "Public users can write mapping" ON sku_marketplace_mapping FOR ALL TO public USING (true) WITH CHECK (true);

-- Update inventory_snapshot policies
DROP POLICY IF EXISTS "Auth users can read snapshot" ON inventory_snapshot;
DROP POLICY IF EXISTS "Auth users can write snapshot" ON inventory_snapshot;
CREATE POLICY "Public users can read snapshot" ON inventory_snapshot FOR SELECT TO public USING (true);
CREATE POLICY "Public users can write snapshot" ON inventory_snapshot FOR ALL TO public USING (true) WITH CHECK (true);

-- Update marketplace_configs policies
DROP POLICY IF EXISTS "Auth users can read configs" ON marketplace_configs;
DROP POLICY IF EXISTS "Auth users can write configs" ON marketplace_configs;
CREATE POLICY "Public users can read configs" ON marketplace_configs FOR SELECT TO public USING (true);
CREATE POLICY "Public users can write configs" ON marketplace_configs FOR ALL TO public USING (true) WITH CHECK (true);

-- Update marketplace_prices policies
DROP POLICY IF EXISTS "Auth users can read prices" ON marketplace_prices;
DROP POLICY IF EXISTS "Auth users can write prices" ON marketplace_prices;
CREATE POLICY "Public users can read prices" ON marketplace_prices FOR SELECT TO public USING (true);
CREATE POLICY "Public users can write prices" ON marketplace_prices FOR ALL TO public USING (true) WITH CHECK (true);

-- View calculated_publishable_stock doesn't have RLS, it inherits from inventory_snapshot.
