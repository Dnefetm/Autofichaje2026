-- =============================================================================
-- FASE 2: Desacoplamiento Asíncrono de Triggers
-- =============================================================================

-- 1. Función Encoladora para Costos
CREATE OR REPLACE FUNCTION trg_costos_articulo_recalcular_async()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Solo encolar si el artículo está vigente y cambió su valor
    IF NEW.articulo_id IS NOT NULL AND NEW.vigente = true THEN
        -- Insertamos un Job asíncrono. El worker lo drenará sin bloquear la BD.
        INSERT INTO jobs (type, payload, status)
        SELECT 
            'recalc_pricing_bundle',
            jsonb_build_object('publicacion_id', m.publicacion_id),
            'pending'
        FROM mapeo_publicacion_articulo m
        WHERE m.sku_articulo = NEW.articulo_id
        ON CONFLICT DO NOTHING; -- Evitar duplicar el recálculo si ya está encolado pendiente
    END IF;
    RETURN NEW;
END;
$$;

-- Remplazar trigger síncrono por asíncrono
DROP TRIGGER IF EXISTS trigger_recalcular_precios ON costos_articulo;
CREATE TRIGGER trigger_recalcular_precios_async
    AFTER INSERT OR UPDATE OF valor, vigente, articulo_id
    ON costos_articulo
    FOR EACH ROW
    EXECUTE FUNCTION trg_costos_articulo_recalcular_async();

-- 2. Función Encoladora para Mapeos (Bundles)
CREATE OR REPLACE FUNCTION trg_mapeo_publicacion_recalcular_async()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Si se inserta, actualiza o borra un componente de un bundle, recalcular su precio
    IF TG_OP = 'DELETE' THEN
        INSERT INTO jobs (type, payload, status)
        VALUES ('recalc_pricing_bundle', jsonb_build_object('publicacion_id', OLD.publicacion_id), 'pending');
        RETURN OLD;
    ELSE
        INSERT INTO jobs (type, payload, status)
        VALUES ('recalc_pricing_bundle', jsonb_build_object('publicacion_id', NEW.publicacion_id), 'pending');
        RETURN NEW;
    END IF;
END;
$$;

-- Trigger para mapeo_publicacion_articulo
DROP TRIGGER IF EXISTS trigger_recalcular_precios_mapeo ON mapeo_publicacion_articulo;
CREATE TRIGGER trigger_recalcular_precios_mapeo
    AFTER INSERT OR UPDATE OF cantidad_requerida, sku_articulo OR DELETE
    ON mapeo_publicacion_articulo
    FOR EACH ROW
    EXECUTE FUNCTION trg_mapeo_publicacion_recalcular_async();
