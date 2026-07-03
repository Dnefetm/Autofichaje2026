-- DEPLOY: fn_resolver_y_poblar_costos (REESCRITURA OPTIMIZADA)
-- Objetivo: eliminar el cuello de botella del JOIN y hacerla idempotente
-- Requisitos previos (T1): indices GIN/BTREE aplicados en costos_articulo
-- NOTA: NO ejecutar durante incidente Supabase (validar SELECT 1; primero)

CREATE OR REPLACE FUNCTION public.fn_resolver_y_poblar_costos(p_importacion_id bigint)
RETURNS TABLE(filas_procesadas integer, filas_resueltas integer, filas_pendientes integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_procesadas integer := 0;
  v_resueltas integer := 0;
  v_pendientes integer := 0;
BEGIN
  WITH resueltos AS (
    UPDATE public.costos_articulo ca
    SET articulo_id = m.articulo_id, estado = 'resuelto', actualizado_en = now()
    FROM public.staging_costos sc
    JOIN public.mapeo_proveedor_articulo m ON m.proveedor_id = sc.proveedor_id AND m.codigo_proveedor = sc.codigo_proveedor
    WHERE ca.importacion_id = p_importacion_id AND ca.staging_id = sc.id AND ca.estado IS DISTINCT FROM 'resuelto'
    RETURNING ca.id )
  SELECT count(*) INTO v_resueltas FROM resueltos;

  WITH pendientes AS (
    UPDATE public.costos_articulo ca
    SET estado = 'pendiente', actualizado_en = now()
    WHERE ca.importacion_id = p_importacion_id AND ca.articulo_id IS NULL AND ca.estado IS DISTINCT FROM 'pendiente'
    RETURNING ca.id )
  SELECT count(*) INTO v_pendientes FROM pendientes;

  SELECT count(*) INTO v_procesadas FROM public.costos_articulo WHERE importacion_id = p_importacion_id;
  RETURN QUERY SELECT v_procesadas, v_resueltas, v_pendientes;
END;
$$;

-- VALIDACION post-deploy (ejecutar aparte):
-- EXPLAIN ANALYZE SELECT * FROM public.fn_resolver_y_poblar_costos(<ID>);
