CREATE OR REPLACE FUNCTION fn_recalcular_precio_marketplace_all(p_marketplace_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT DISTINCT articulo_id 
        FROM costos_articulo 
        WHERE articulo_id IS NOT NULL 
          AND vigente = true
    )
    LOOP
        PERFORM fn_recalcular_precio_marketplace(r.articulo_id);
    END LOOP;
END;
$$;
