-- Fix B: Proceso de promoción con candado anti-pruebas
CREATE OR REPLACE FUNCTION public.fn_marcar_vigente(p_importacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_proveedor text;
    v_total_filas_nuevo int;
    v_total_filas_actual int;
    v_importacion_id_actual uuid;
BEGIN
    SELECT proveedor, total_filas INTO v_proveedor, v_total_filas_nuevo 
    FROM importaciones_excel WHERE id = p_importacion_id;
    
    -- Obtener la importación vigente actual
    SELECT importacion_id, total_filas INTO v_importacion_id_actual, v_total_filas_actual
    FROM public.listas_precios_proveedor
    WHERE proveedor = v_proveedor AND vigente = true
    LIMIT 1;

    -- Candado anti-pruebas: Si la nueva lista tiene menos del 50% de las filas de la lista actual, NO promover automáticamente.
    IF v_total_filas_actual IS NOT NULL AND v_total_filas_nuevo < (v_total_filas_actual * 0.5) THEN
        RAISE NOTICE 'No se promueve la lista % porque tiene demasiadas pocas filas (% vs %). Parece un archivo de prueba.', p_importacion_id, v_total_filas_nuevo, v_total_filas_actual;
        RETURN;
    END IF;

    -- Apagar listas anteriores del proveedor
    UPDATE public.listas_precios_proveedor
    SET vigente = false, fecha_vigor_hasta = now()
    WHERE proveedor = v_proveedor
      AND vigente = true
      AND importacion_id <> p_importacion_id;

    -- Encender la nueva lista si tiene al menos un articulo
    IF (SELECT count(*) FROM costos_articulo WHERE importacion_id = p_importacion_id) > 0 THEN
        UPDATE public.listas_precios_proveedor
        SET vigente = true
        WHERE importacion_id = p_importacion_id;
    END IF;
END;
$$;
