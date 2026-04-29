CREATE OR REPLACE FUNCTION public.fn_confirmar_decisiones_masivo(p_ids uuid[], p_accion text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_accion = 'confirmar' THEN
        -- Actualizar estado a confirmado
        UPDATE matching_decisiones
        SET estado = 'confirmado', confirmado = true
        WHERE id = ANY(p_ids);

        -- Propagar a costos_articulo
        UPDATE costos_articulo ca
        SET articulo_id = md.cand_articulo_id,
            vigente = true
        FROM matching_decisiones md
        WHERE md.id = ANY(p_ids)
          AND ca.importacion_id = md.importacion_id
          AND ca.codigo_universal_excel = md.codigo_universal_excel
          AND ca.marca_excel = md.marca_excel
          AND ca.modelo_excel = md.modelo_excel;

    ELSIF p_accion = 'rechazar' THEN
        UPDATE matching_decisiones
        SET estado = 'rechazado', confirmado = false
        WHERE id = ANY(p_ids);
    END IF;
END;
$$;
