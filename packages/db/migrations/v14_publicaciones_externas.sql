-- Migración V14: Arquitectura Meli Listings -> Catálogo Físico

-- 1. Crear tabla de Vitrinas/Publicaciones Externas (Lo que se descarga de Meli)
CREATE TABLE IF NOT EXISTS publicaciones_externas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    marketplace_id UUID REFERENCES marketplace_configs(id),
    external_item_id TEXT NOT NULL,          -- ej. MLM123456
    external_variation_id TEXT,              -- Para ropa/colores
    
    titulo TEXT NOT NULL,                    -- Exacto como viene en MeLi
    precio_venta NUMERIC(10,2),
    stock_publicado INTEGER,
    status_externo TEXT,                     -- active, paused
    
    esta_mapeado BOOLEAN DEFAULT false,      -- Luz roja/verde en tu UI
    
    -- Metadatos adicionales opcionales de MeLi
    url_imagen TEXT,
    permalink TEXT,
    
    creado_el TIMESTAMPTZ DEFAULT now(),
    actualizado_el TIMESTAMPTZ DEFAULT now(),
    
    -- No puedes tener la misma publicación 2 veces exacta en la misma cuenta
    UNIQUE (marketplace_id, external_item_id, external_variation_id)
);

-- 2. Crear tabla Puente (El armado de Kits y conexión Vitrina -> Bodega)
CREATE TABLE IF NOT EXISTS mapeo_publicacion_articulo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publicacion_id UUID REFERENCES publicaciones_externas(id) ON DELETE CASCADE NOT NULL,
    sku_articulo TEXT REFERENCES articulos(sku) ON DELETE CASCADE NOT NULL,
    cantidad_requerida INTEGER DEFAULT 1,    
    
    -- No puedes mapear el mismo SKU físico 2 veces en la misma publicación (se suma la cantidad si eso pasa)
    UNIQUE(publicacion_id, sku_articulo)
);

-- 3. Trigger para actualizar automáticamente 'esta_mapeado' cuando se añadan/quiten mapeos

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

-- 4. Opcional: Eliminar restricciones de la vieja tabla sku_marketplace_mapping si decidimos dropearla luego. 
-- Por ahora la dejamos vivir en paralelo mientras migramos los datos (o la podemos ignorar).
