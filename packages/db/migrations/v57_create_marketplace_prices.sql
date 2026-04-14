-- =============================================================================
-- MIGRACIÓN v57: Crear tabla marketplace_prices (que faltaba en producción)
-- =============================================================================
-- CONTEXTO:
--   Las migraciones v46, v47, v47b, v50 hacían ALTER TABLE marketplace_prices
--   pero la tabla nunca se creó con CREATE TABLE en ninguna migración aplicada.
--   El API route /api/catalog/[id]/prices falla con error 500 en producción
--   porque hace queries contra esta tabla inexistente.
--
-- DISEÑO:
--   marketplace_prices es la tabla operativa de precios por artículo+cuenta MeLi.
--   precios_publicacion es la tabla del motor de reglas (pipeline de precios del proveedor).
--   Ambas coexisten: una para edición manual rápida, otra para el pipeline automatizado.
--
-- COLUMNAS: basadas en lo que usan v47, v47b, v50 y el API route existente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS marketplace_prices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    articulo_id     TEXT NOT NULL REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    marketplace_id  UUID NOT NULL REFERENCES marketplace_configs(id) ON DELETE CASCADE,

    -- Precios
    base_price      NUMERIC(12, 2),           -- Precio de lista/referencia (opcional)
    sale_price      NUMERIC(12, 2) NOT NULL,  -- Precio de venta activo
    currency        TEXT NOT NULL DEFAULT 'MXN',

    -- SKU para esa tienda (default: articulo.modelo)
    sku_tienda      TEXT,

    -- Auditoría
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Unicidad: un precio por artículo+cuenta
    CONSTRAINT uq_marketplace_prices_articulo_cuenta
        UNIQUE (articulo_id, marketplace_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_marketplace_prices_articulo
    ON marketplace_prices (articulo_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_prices_marketplace
    ON marketplace_prices (marketplace_id);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION fn_set_marketplace_prices_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketplace_prices_updated_at ON marketplace_prices;
CREATE TRIGGER trg_marketplace_prices_updated_at
    BEFORE UPDATE ON marketplace_prices
    FOR EACH ROW
    EXECUTE FUNCTION fn_set_marketplace_prices_updated_at();

-- RLS: heredar política permisiva (misma que el resto del schema)
ALTER TABLE marketplace_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON marketplace_prices
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ─── Verificación ─────────────────────────────────────────────────────────────
-- SELECT count(*) FROM marketplace_prices;
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'marketplace_prices' ORDER BY ordinal_position;
