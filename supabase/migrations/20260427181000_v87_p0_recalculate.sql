-- Forzar el recálculo de los bundles (P0)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT DISTINCT articulo_id 
        FROM mapeo_publicacion_articulo 
        WHERE cantidad_requerida > 1
    ) LOOP
        PERFORM fn_recalcular_precio_marketplace(r.articulo_id);
    END LOOP;
END;
$$;
