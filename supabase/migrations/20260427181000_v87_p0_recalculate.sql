-- Forzar el recálculo de los bundles (P0)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT DISTINCT sku_articulo 
        FROM mapeo_publicacion_articulo 
        WHERE cantidad_requerida > 1
    ) LOOP
        PERFORM fn_recalcular_precio_marketplace(r.sku_articulo);
    END LOOP;
END;
$$;
