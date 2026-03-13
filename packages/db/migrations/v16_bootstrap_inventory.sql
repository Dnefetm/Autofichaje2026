-- Migración V16: Bootstrap de inventario + trigger automático + sync_disabled
-- Fecha: 13-mar-2026

-- ============================================================
-- 1. COLUMNA sync_disabled EN publicaciones_externas
-- Marca publicaciones que MeLi rechaza permanentemente (fulfillment/catálogo)
-- ============================================================
ALTER TABLE publicaciones_externas
    ADD COLUMN IF NOT EXISTS sync_disabled BOOLEAN DEFAULT false;

ALTER TABLE publicaciones_externas
    ADD COLUMN IF NOT EXISTS sync_disabled_reason TEXT;

-- Índice para filtrar en el worker
CREATE INDEX IF NOT EXISTS idx_pub_ext_sync_disabled
    ON publicaciones_externas(sync_disabled)
    WHERE sync_disabled = true;

-- ============================================================
-- 2. BOOTSTRAP: Crear snapshots vacíos para todos los artículos
-- que no tienen fila en inventory_snapshot (7,543 artículos)
-- physical_stock = 0 por defecto (valor conservador)
-- ============================================================
INSERT INTO inventory_snapshot (sku, physical_stock, updated_at)
SELECT
    a.articulo_id,
    0,
    NOW()
FROM articulos a
WHERE NOT EXISTS (
    SELECT 1 FROM inventory_snapshot i WHERE i.sku = a.articulo_id
);

-- ============================================================
-- 3. TRIGGER: Auto-crear snapshot al insertar un artículo nuevo
-- Previene que vuelva a haber artículos sin snapshot
-- ============================================================
CREATE OR REPLACE FUNCTION fn_auto_create_inventory_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO inventory_snapshot (sku, physical_stock, updated_at)
    VALUES (NEW.articulo_id, 0, NOW())
    ON CONFLICT (sku) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_inventory_snapshot ON articulos;

CREATE TRIGGER trg_auto_create_inventory_snapshot
    AFTER INSERT ON articulos
    FOR EACH ROW
    EXECUTE FUNCTION fn_auto_create_inventory_snapshot();

-- ============================================================
-- 4. TRIGGER: Auto-crear snapshot al crear un mapeo nuevo
-- Si alguien mapea un artículo que aún no tiene snapshot, lo crea
-- ============================================================
CREATE OR REPLACE FUNCTION fn_ensure_snapshot_on_mapping()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO inventory_snapshot (sku, physical_stock, updated_at)
    VALUES (NEW.articulo_id, 0, NOW())
    ON CONFLICT (sku) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_snapshot_on_mapping ON mapeo_publicacion_articulo;

CREATE TRIGGER trg_ensure_snapshot_on_mapping
    AFTER INSERT ON mapeo_publicacion_articulo
    FOR EACH ROW
    EXECUTE FUNCTION fn_ensure_snapshot_on_mapping();

-- ============================================================
-- 5. PURGE AUTOMÁTICO: función para limpiar jobs failed > 7 días
-- (se invoca desde el cron de Vercel)
-- ============================================================
CREATE OR REPLACE FUNCTION purge_old_failed_jobs()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
    deleted INTEGER;
BEGIN
    DELETE FROM jobs
    WHERE status = 'failed'
      AND created_at < NOW() - INTERVAL '7 days';
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$;
