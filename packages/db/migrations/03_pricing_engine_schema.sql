-- MIGRACIÓN: Motor de Precios ERP

-- 1. Añadir Costo Base al Maestro de SKUs
ALTER TABLE skus ADD COLUMN IF NOT EXISTS base_cost NUMERIC(10,2) DEFAULT 0.00;

-- 2. Tabla de Reglas de Precio Dinámico por Marketplace
CREATE TABLE IF NOT EXISTS pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace_id UUID REFERENCES marketplace_configs(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- ej. 'MeLi Global +30%'
    rule_type TEXT NOT NULL, -- 'margin_percentage', 'fixed_markup'
    value NUMERIC(10,2) NOT NULL, -- Ej: 30 para 30%, 150 para $150
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Historial de auditoría para Tabulador
CREATE TABLE IF NOT EXISTS pricing_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id TEXT NOT NULL, -- Identificador de la subida del CSV
    sku TEXT REFERENCES skus(sku) ON DELETE CASCADE,
    old_base_cost NUMERIC(10,2),
    new_base_cost NUMERIC(10,2),
    created_at TIMESTAMPTZ DEFAULT now()
);
