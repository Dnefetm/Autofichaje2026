-- Forzar recálculo para todo lo que tenga articulo_id y un estado confirmado o exacto
-- ignorando vigente = true, por si las filas antiguas no lo tienen seteado correctamente.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT DISTINCT articulo_id 
        FROM costos_articulo 
        WHERE articulo_id IS NOT NULL 
          AND (vigente = true OR estado_match IN ('confirmado', 'match_exacto', 'codigo_cambiado'))
    )
    LOOP
        PERFORM fn_recalcular_precio_marketplace(r.articulo_id);
    END LOOP;
END;
$$;
