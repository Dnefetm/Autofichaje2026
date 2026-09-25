BEGIN;

CREATE OR REPLACE FUNCTION public.fn_consolidar_matching_decisiones(p_importacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- 2.1 Desactivar costos previos para el proveedor y los articulos que vamos a confirmar
    UPDATE costos_articulo ca_old
    SET vigente = false
    FROM matching_decisiones md
    JOIN importaciones_excel ie ON ie.id = md.importacion_id
    WHERE md.importacion_id = p_importacion_id
      AND md.confirmado = true
      AND md.articulo_id_final IS NOT NULL
      AND ca_old.proveedor = ie.proveedor
      AND ca_old.articulo_id = md.articulo_id_final
      AND ca_old.tipo_costo = ie.tipo_costo_default
      AND ca_old.importacion_id != p_importacion_id;

    -- 2.2 Actualizar las filas actuales en costos_articulo con las decisiones tomadas
    UPDATE costos_articulo ca
    SET articulo_id = md.articulo_id_final,
        vigente = true,
        estado_match = 'completado'
    FROM matching_decisiones md
    WHERE ca.importacion_id = p_importacion_id
      AND md.importacion_id = p_importacion_id
      AND md.confirmado = true
      AND md.articulo_id_final IS NOT NULL
      AND NOT ca.codigo_universal_excel IS DISTINCT FROM md.codigo_universal_excel
      AND NOT ca.marca_excel IS DISTINCT FROM md.marca_excel
      AND NOT ca.modelo_excel IS DISTINCT FROM md.modelo_excel
      AND NOT ca.nombre_excel IS DISTINCT FROM md.nombre_excel;

    -- 2.3 FEEDBACK LOOP: APRENDIZAJE DE ALIAS PARA PRODUCTOS CON CÓDIGO (UPSERT)
    INSERT INTO proveedor_articulos_alias (proveedor, codigo_excel, marca_excel, modelo_excel, articulo_id)
    SELECT ie.proveedor, md.codigo_universal_excel, md.marca_excel, md.modelo_excel, md.articulo_id_final
    FROM matching_decisiones md
    JOIN importaciones_excel ie ON ie.id = md.importacion_id
    WHERE md.importacion_id = p_importacion_id 
      AND md.confirmado = true 
      AND md.articulo_id_final IS NOT NULL
      AND md.codigo_universal_excel IS NOT NULL 
      AND md.codigo_universal_excel <> ''
    ON CONFLICT (proveedor, codigo_excel) WHERE codigo_excel IS NOT NULL AND codigo_excel <> ''
    DO UPDATE SET 
        articulo_id = EXCLUDED.articulo_id, 
        marca_excel = EXCLUDED.marca_excel, 
        modelo_excel = EXCLUDED.modelo_excel, 
        ultima_vez_visto = now(),
        estado_proveedor = 'activo'
    WHERE proveedor_articulos_alias.locked = false;

    -- 2.4 FEEDBACK LOOP: APRENDIZAJE DE ALIAS PARA PRODUCTOS SIN CÓDIGO (UPSERT)
    INSERT INTO proveedor_articulos_alias (proveedor, codigo_excel, marca_excel, modelo_excel, articulo_id)
    SELECT ie.proveedor, md.codigo_universal_excel, md.marca_excel, md.modelo_excel, md.articulo_id_final
    FROM matching_decisiones md
    JOIN importaciones_excel ie ON ie.id = md.importacion_id
    WHERE md.importacion_id = p_importacion_id 
      AND md.confirmado = true 
      AND md.articulo_id_final IS NOT NULL
      AND (md.codigo_universal_excel IS NULL OR md.codigo_universal_excel = '')
    ON CONFLICT (proveedor, marca_excel, modelo_excel) WHERE codigo_excel IS NULL OR codigo_excel = ''
    DO UPDATE SET 
        articulo_id = EXCLUDED.articulo_id, 
        ultima_vez_visto = now(),
        estado_proveedor = 'activo'
    WHERE proveedor_articulos_alias.locked = false;

END;
$$;

COMMIT;
