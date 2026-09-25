CREATE OR REPLACE FUNCTION public.fn_poblar_matching_decisiones()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Limpiar por si acaso (idempotencia)
    DELETE FROM matching_decisiones WHERE importacion_id = NEW.id;

    -- Poblar usando la vista de heurística de Comet
    INSERT INTO matching_decisiones (
        importacion_id, 
        nivel, 
        pct, 
        preseleccionado, 
        confirmado, 
        cand_articulo_id, 
        cand_marca, 
        cand_modelo, 
        cand_codigo, 
        cand_nombre, 
        articulo_id_final,
        proveedor,
        codigo_universal_excel,
        marca_excel,
        modelo_excel,
        nombre_excel
    )
    SELECT 
        v.importacion_id,
        v.nivel,
        v.pct,
        (v.nivel = 1) AS preseleccionado, -- Nivel 1 se pre-selecciona automáticamente
        (v.nivel = 1) AS confirmado,      -- Lo marcamos como confirmado por defecto para agilizar
        v.cand_articulo_id,
        v.cand_marca,
        v.cand_modelo,
        v.cand_codigo,
        v.cand_nombre,
        CASE WHEN v.nivel = 1 THEN v.cand_articulo_id ELSE NULL END AS articulo_id_final,
        v.proveedor,
        v.codigo_universal_excel,
        v.marca_excel,
        v.modelo_excel,
        v.nombre_excel
    FROM v_matching_candidatos v
    WHERE v.importacion_id = NEW.id
    ON CONFLICT DO NOTHING; -- Para evitar fallos por duplicados exactos si los hay

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_poblar_matching_decisiones ON importaciones_excel;
CREATE TRIGGER trg_poblar_matching_decisiones
AFTER UPDATE OF estado ON importaciones_excel
FOR EACH ROW
WHEN (NEW.estado = 'matching_completo' AND OLD.estado != 'matching_completo')
EXECUTE FUNCTION public.fn_poblar_matching_decisiones();
