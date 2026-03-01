-- SCHEMA UNIFICADO: GESTOR + AUTOFICHAS

-- 1. Categorías (AUTOFICHAS)
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES categories(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. SKUs Core (Catálogo Maestro)
CREATE TABLE IF NOT EXISTS skus (
    sku TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT,
    category_id UUID REFERENCES categories(id),
    description TEXT,
    images TEXT[], -- URLs
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb, -- Atributos técnicos dinámicos (AUTOFICHAS Part 2)
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Fuentes de Documentos (AUTOFICHAS)
CREATE TABLE IF NOT EXISTS document_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT REFERENCES skus(sku),
    source_type TEXT NOT NULL, -- 'pdf', 'image', 'url'
    source_url TEXT NOT NULL,
    ocr_raw_text TEXT,
    confidence_score FLOAT,
    status TEXT DEFAULT 'pending', -- 'pending', 'processed', 'failed'
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Inventario Snapshot (GESTOR)
CREATE TABLE IF NOT EXISTS inventory_snapshot (
    sku TEXT PRIMARY KEY REFERENCES skus(sku) ON DELETE CASCADE,
    physical_stock INTEGER DEFAULT 0,
    dropship_stock INTEGER DEFAULT 0,
    reserved_stock INTEGER DEFAULT 0,
    -- total_stock e available_stock generados por lógica de aplicación o triggers
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Configuración de Cuentas de Marketplace (GESTOR)
CREATE TABLE IF NOT EXISTS marketplace_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace TEXT NOT NULL, -- 'meli', 'amazon', 'walmart', 'coppel', 'tiktok'
    account_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}'::jsonb, -- rate limits, etc
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Mapeo SKU-Marketplace (GESTOR)
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

-- 7. Precios por Marketplace (GESTOR + AUTOFICHAS)
CREATE TABLE IF NOT EXISTS marketplace_prices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT REFERENCES skus(sku),
    marketplace_id UUID REFERENCES marketplace_configs(id),
    base_price NUMERIC(12, 2), -- Precio costo / base
    sale_price NUMERIC(12, 2) NOT NULL,
    shipping_cost NUMERIC(12, 2) DEFAULT 0,
    currency TEXT DEFAULT 'MXN',
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(sku, marketplace_id)
);

-- 8. Cola de Trabajos (GESTOR)
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL, -- 'sync_stock', 'sync_price', 'create_listing', 'ocr_process'
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ,
    error_log TEXT,
    checkpoint JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Logs de Sincronización (GESTOR)
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

-- 10. Transacciones de Inventario (GESTOR)
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku TEXT REFERENCES skus(sku),
    delta INTEGER NOT NULL,
    source TEXT NOT NULL, -- 'sale', 'refund', 'adjustment', 'dropship_update'
    reference_id TEXT, -- Order ID o Job ID
    resulting_stock INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 11. Tokens OAuth (GESTOR)
CREATE TABLE IF NOT EXISTS marketplace_tokens (
    marketplace_id UUID PRIMARY KEY REFERENCES marketplace_configs(id),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 12. Bundles / Kits (GESTOR)
CREATE TABLE IF NOT EXISTS bundle_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_sku TEXT REFERENCES skus(sku),
    component_sku TEXT REFERENCES skus(sku),
    quantity INTEGER DEFAULT 1,
    UNIQUE(bundle_sku, component_sku)
);

-- 13. Alertas de Sistema (GESTOR)
CREATE TABLE IF NOT EXISTS system_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level TEXT NOT NULL, -- 'info', 'warning', 'critical'
    type TEXT NOT NULL, -- 'low_stock', 'sync_error', 'token_expired'
    message TEXT NOT NULL,
    sku TEXT REFERENCES skus(sku),
    marketplace_id UUID REFERENCES marketplace_configs(id),
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);
