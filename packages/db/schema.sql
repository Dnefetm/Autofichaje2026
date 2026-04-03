-- SCHEMA UNIFICADO: GESTOR + AUTOFICHAS
-- Actualizado: tabla 'skus' y 'categories' eliminadas.
-- Catálogo maestro ahora en 'articulos' (ver v13_migration.sql).
-- FKs redirigidas a articulos(articulo_id).

-- 1. Fuentes de Documentos (AUTOFICHAS)
CREATE TABLE IF NOT EXISTS document_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT REFERENCES articulos(articulo_id) ON DELETE SET NULL,
    source_type TEXT NOT NULL, -- 'pdf', 'image', 'url'
    source_url TEXT NOT NULL,
    ocr_raw_text TEXT,
    confidence_score FLOAT,
    status TEXT DEFAULT 'pending', -- 'pending', 'processed', 'failed'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Inventario Snapshot (GESTOR)
CREATE TABLE IF NOT EXISTS inventory_snapshot (
    sku TEXT PRIMARY KEY REFERENCES articulos(articulo_id) ON DELETE RESTRICT,
    physical_stock INTEGER DEFAULT 0,
    dropship_stock INTEGER DEFAULT 0,
    reserved_stock INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Configuración de Cuentas de Marketplace (GESTOR)
CREATE TABLE IF NOT EXISTS marketplace_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace TEXT NOT NULL, -- 'meli', 'amazon', 'walmart', 'coppel', 'tiktok'
    account_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(marketplace, account_name)
);

-- 4. Mapeo SKU-Marketplace (GESTOR)
CREATE TABLE IF NOT EXISTS sku_marketplace_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    marketplace_id UUID REFERENCES marketplace_configs(id),
    external_item_id TEXT NOT NULL,
    external_variation_id TEXT,
    sync_status TEXT DEFAULT 'active',
    last_sync_at TIMESTAMPTZ,
    UNIQUE(marketplace_id, external_item_id, external_variation_id)
);

-- 5. Precios por Marketplace (GESTOR + AUTOFICHAS)
CREATE TABLE IF NOT EXISTS marketplace_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    articulo_id TEXT NOT NULL REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    marketplace_id UUID REFERENCES marketplace_configs(id),
    sku_tienda TEXT,          -- SKU de tienda (= articulo.modelo por default)
    base_price NUMERIC(12, 2),
    sale_price NUMERIC(12, 2) NOT NULL,
    shipping_cost NUMERIC(12, 2) DEFAULT 0,
    currency TEXT DEFAULT 'MXN',
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(articulo_id, marketplace_id)
);

-- 6. Cola de Trabajos (GESTOR)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ,
    error_log TEXT,
    checkpoint JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Logs de Sincronización (GESTOR)
CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id),
    marketplace_id UUID REFERENCES marketplace_configs(id),
    operation TEXT NOT NULL,
    items_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_details JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Transacciones de Inventario (GESTOR)
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    source TEXT NOT NULL,
    reference_id TEXT,
    resulting_stock INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Tokens OAuth (GESTOR)
CREATE TABLE IF NOT EXISTS marketplace_tokens (
    marketplace_id UUID PRIMARY KEY REFERENCES marketplace_configs(id),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 10. Bundles / Kits (GESTOR)
CREATE TABLE IF NOT EXISTS bundle_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_sku TEXT REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    component_sku TEXT REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1,
    UNIQUE(bundle_sku, component_sku)
);

-- 11. Alertas de Sistema (GESTOR)
CREATE TABLE IF NOT EXISTS system_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    sku TEXT REFERENCES articulos(articulo_id) ON DELETE SET NULL,
    marketplace_id UUID REFERENCES marketplace_configs(id),
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 12. Vistas Operativas (GESTOR)
CREATE OR REPLACE VIEW calculated_publishable_stock AS
SELECT 
    sku,
    physical_stock,
    reserved_stock,
    dropship_stock,
    GREATEST(0, physical_stock + dropship_stock - reserved_stock) as calculated_available_stock
FROM inventory_snapshot;
