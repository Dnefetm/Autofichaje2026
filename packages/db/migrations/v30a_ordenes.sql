-- v30a_ordenes.sql — Tablas para órdenes de MercadoLibre y reservación de stock
-- Depende de: marketplace_configs, publicaciones_externas, articulos (todas en migraciones anteriores)

-- ══════════════════════════════════════════════════════════════════════
-- TABLA ordenes
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ordenes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace_id          UUID NOT NULL REFERENCES marketplace_configs(id),
    meli_order_id           BIGINT NOT NULL,
    pack_id                 BIGINT,
    status                  TEXT NOT NULL
        CHECK (status IN ('confirmed','payment_required','payment_in_process',
                          'partially_paid','paid','cancelled')),
    date_created            TIMESTAMPTZ NOT NULL,
    date_closed             TIMESTAMPTZ,
    buyer_id                BIGINT NOT NULL,
    total_amount            NUMERIC(12,2) NOT NULL,
    paid_amount             NUMERIC(12,2),
    currency_id             TEXT DEFAULT 'MXN',
    shipping_id             BIGINT,
    shipping_logistic_type  TEXT,            -- 'fulfillment' | 'drop_off' | 'xd_drop_off' | etc.
    buying_mode             TEXT,            -- 'buy_it_now' | 'auction'
    tags                    JSONB DEFAULT '[]',
    raw_json                JSONB NOT NULL,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE (marketplace_id, meli_order_id)
);

CREATE INDEX IF NOT EXISTS idx_ordenes_marketplace_status
    ON ordenes (marketplace_id, status);
CREATE INDEX IF NOT EXISTS idx_ordenes_date_created
    ON ordenes (date_created DESC);

-- ══════════════════════════════════════════════════════════════════════
-- TABLA orden_items
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS orden_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_id            UUID NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
    meli_item_id        TEXT NOT NULL,
    meli_variation_id   TEXT,
    titulo              TEXT,
    quantity            INTEGER NOT NULL,
    unit_price          NUMERIC(12,2) NOT NULL,
    full_unit_price     NUMERIC(12,2),
    seller_sku          TEXT,
    publicacion_id      UUID REFERENCES publicaciones_externas(id),
    articulo_id         TEXT REFERENCES articulos(articulo_id),
    created_at          TIMESTAMPTZ DEFAULT now(),
    -- necesario para upsert idempotente en handleProcessSale
    UNIQUE (orden_id, meli_item_id, meli_variation_id)
);

CREATE INDEX IF NOT EXISTS idx_orden_items_orden_id
    ON orden_items (orden_id);
CREATE INDEX IF NOT EXISTS idx_orden_items_articulo_id
    ON orden_items (articulo_id);

-- ══════════════════════════════════════════════════════════════════════
-- TABLA reservaciones_stock
-- Solo para órdenes cuyo envío NO sea Fulfillment.
-- El trigger v30b actualiza inventory_snapshot.reserved_stock automáticamente.
-- ══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reservaciones_stock (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    orden_item_id   UUID NOT NULL REFERENCES orden_items(id) ON DELETE CASCADE,
    articulo_id     TEXT NOT NULL REFERENCES articulos(articulo_id),
    cantidad        INTEGER NOT NULL,
    estado          TEXT NOT NULL DEFAULT 'activa'
        CHECK (estado IN ('activa','consumida','liberada')),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservaciones_articulo_estado
    ON reservaciones_stock (articulo_id, estado);
CREATE INDEX IF NOT EXISTS idx_reservaciones_orden_item
    ON reservaciones_stock (orden_item_id);
