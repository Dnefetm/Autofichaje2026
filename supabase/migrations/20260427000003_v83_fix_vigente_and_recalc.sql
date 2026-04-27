-- Update ALL confirmed rows to ensure they have vigente = true
UPDATE costos_articulo
SET vigente = true
WHERE estado_match IN ('confirmado', 'match_exacto', 'codigo_cambiado')
  AND (vigente IS NULL OR vigente = false);

-- Recalcular todos
DO $$
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
