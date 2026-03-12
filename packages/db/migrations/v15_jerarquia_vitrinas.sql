-- Migración V15: Jerarquía de Publicaciones + Tabla Puente Definitiva + Vista de Stock
-- Fecha: 11-mar-2026
-- Prerrequisito: V14 (publicaciones_externas y mapeo_publicacion_articulo deben existir)

-- ============================================================
-- 1. COLUMNAS DE JERARQUÍA EN publicaciones_externas
-- ============================================================

-- Tipo: 'tradicional', 'catalogo', 'tradicional_derivada', 'catalogo_derivada'
ALTER TABLE publicaciones_externas 
    ADD COLUMN IF NOT EXISTS tipo_publicacion TEXT DEFAULT 'tradicional';

-- external_item_id del padre. NULL si es tradicional padre.
ALTER TABLE publicaciones_externas 
    ADD COLUMN IF NOT EXISTS id_publicacion_padre TEXT;

-- Solo true para publicaciones Tradicional Padre (fuente de verdad de stock)
ALTER TABLE publicaciones_externas 
    ADD COLUMN IF NOT EXISTS es_fuente_stock BOOLEAN DEFAULT false;

-- ID del producto de catálogo de MeLi (opcional, para buy box tracking)
ALTER TABLE publicaciones_externas 
    ADD COLUMN IF NOT EXISTS id_producto_catalogo TEXT;

-- Índices parciales para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_pub_ext_parent 
    ON publicaciones_externas(id_publicacion_padre) 
    WHERE id_publicacion_padre IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pub_ext_tipo 
    ON publicaciones_externas(tipo_publicacion);

CREATE INDEX IF NOT EXISTS idx_pub_ext_fuente_stock 
    ON publicaciones_externas(es_fuente_stock) 
    WHERE es_fuente_stock = true;

-- ============================================================
-- 2. TABLA PUENTE: mapeo_publicacion_articulo (RECREAR SI NECESARIO)
-- ============================================================
-- Si la tabla ya existe con columna sku_articulo, renombramos.
-- Si no existe, la creamos desde cero.

-- Renombrar columna sku_articulo -> articulo_id si existe la columna vieja
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'mapeo_publicacion_articulo' 
        AND column_name = 'sku_articulo'
    ) THEN
        ALTER TABLE mapeo_publicacion_articulo RENAME COLUMN sku_articulo TO articulo_id;
    END IF;
END $$;

-- Si la tabla no existe, crearla desde cero
CREATE TABLE IF NOT EXISTS mapeo_publicacion_articulo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publicacion_id UUID NOT NULL REFERENCES publicaciones_externas(id) ON DELETE CASCADE,
    articulo_id TEXT NOT NULL,
    cantidad_requerida INTEGER DEFAULT 1 CHECK (cantidad_requerida > 0),
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(publicacion_id, articulo_id)
);

-- Índices para lookups frecuentes
CREATE INDEX IF NOT EXISTS idx_mapeo_pub ON mapeo_publicacion_articulo(publicacion_id);
CREATE INDEX IF NOT EXISTS idx_mapeo_art ON mapeo_publicacion_articulo(articulo_id);

-- ============================================================
-- 3. TRIGGER: esta_mapeado automático
-- ============================================================
-- Reemplazar el trigger existente (idempotente)

CREATE OR REPLACE FUNCTION actualizar_estado_mapeo_publicacion()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE publicaciones_externas 
        SET esta_mapeado = true, actualizado_el = now()
        WHERE id = NEW.publicacion_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- Verificar si quedan otros mapeos
        IF NOT EXISTS (SELECT 1 FROM mapeo_publicacion_articulo WHERE publicacion_id = OLD.publicacion_id) THEN
            UPDATE publicaciones_externas 
            SET esta_mapeado = false, actualizado_el = now()
            WHERE id = OLD.publicacion_id;
        END IF;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_actualizar_mapeo ON mapeo_publicacion_articulo;

CREATE TRIGGER trg_actualizar_mapeo
AFTER INSERT OR DELETE ON mapeo_publicacion_articulo
FOR EACH ROW
EXECUTE FUNCTION actualizar_estado_mapeo_publicacion();

-- ============================================================
-- 4. VISTA: vista_stock_real (Dashboard interno)
-- ============================================================
-- Muestra el stock calculado por publicación mapeada (Kit-Aware)

CREATE OR REPLACE VIEW vista_stock_real AS
SELECT
    pe.id AS publicacion_id,
    pe.external_item_id,
    pe.titulo,
    pe.tipo_publicacion,
    pe.es_fuente_stock,
    pe.stock_publicado AS stock_en_meli,
    pe.marketplace_id,
    -- Stock calculado: mínimo de (physical_stock / cantidad_requerida) por componente
    COALESCE(
        (
            SELECT MIN(FLOOR(COALESCE(inv.physical_stock, 0)::numeric / m.cantidad_requerida))
            FROM mapeo_publicacion_articulo m
            LEFT JOIN inventory_snapshot inv ON inv.sku = m.articulo_id
            WHERE m.publicacion_id = pe.id
        ),
        0
    )::INTEGER AS stock_calculado,
    pe.esta_mapeado,
    pe.actualizado_el
FROM publicaciones_externas pe
WHERE pe.es_fuente_stock = true;

-- ============================================================
-- 5. MARCAR publicaciones Tradicional Padre existentes
-- ============================================================
-- Las publicaciones que ya existían y no tienen parent se asumen como tradicionales.
-- Este UPDATE se ejecuta una sola vez. Las futuras se clasifican al importar desde la API.

UPDATE publicaciones_externas
SET tipo_publicacion = 'tradicional',
    es_fuente_stock = true
WHERE id_publicacion_padre IS NULL 
  AND tipo_publicacion = 'tradicional';
-- Nota: esto solo afecta las que tienen el default 'tradicional' y no tienen padre.
-- Las de catálogo se reclasificarán cuando se re-sincronicen desde la API.

-- ============================================================
-- 6. POLÍTICAS RLS (Dashboard usa anon key sin sistema de login)
-- ============================================================
-- Patrón existente del proyecto: TO public USING (true)

-- 6a. mapeo_publicacion_articulo — CRUD completo desde el frontend
ALTER TABLE mapeo_publicacion_articulo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read mapeo" ON mapeo_publicacion_articulo;
CREATE POLICY "Public read mapeo" ON mapeo_publicacion_articulo 
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Public write mapeo" ON mapeo_publicacion_articulo;
CREATE POLICY "Public write mapeo" ON mapeo_publicacion_articulo 
    FOR ALL TO public USING (true) WITH CHECK (true);

-- 6b. publicaciones_externas — SELECT ya existe, agregar UPDATE/INSERT/DELETE
ALTER TABLE publicaciones_externas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public write publicaciones" ON publicaciones_externas;
CREATE POLICY "Public write publicaciones" ON publicaciones_externas 
    FOR ALL TO public USING (true) WITH CHECK (true);

-- 6c. articulos — Lectura para el buscador del modal de mapeo
ALTER TABLE articulos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read articulos" ON articulos;
CREATE POLICY "Public read articulos" ON articulos 
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Public write articulos" ON articulos;
CREATE POLICY "Public write articulos" ON articulos 
    FOR ALL TO public USING (true) WITH CHECK (true);

-- 6d. jobs — INSERT desde el frontend (encolar sync_stock_mapped al guardar mapeo)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read jobs" ON jobs;
CREATE POLICY "Public read jobs" ON jobs 
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Public write jobs" ON jobs;
CREATE POLICY "Public write jobs" ON jobs 
    FOR ALL TO public USING (true) WITH CHECK (true);

-- 6e. inventory_snapshot — Lectura para el cálculo de stock en vista
ALTER TABLE inventory_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read snapshot v2" ON inventory_snapshot;
CREATE POLICY "Public read snapshot v2" ON inventory_snapshot 
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Public write snapshot v2" ON inventory_snapshot;
CREATE POLICY "Public write snapshot v2" ON inventory_snapshot 
    FOR ALL TO public USING (true) WITH CHECK (true);
