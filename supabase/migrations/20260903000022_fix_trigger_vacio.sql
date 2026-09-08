-- =============================================================================
-- MIGRACIÓN: corregir trigger de validación de "completado" para el modelo desacoplado.
-- El trigger viejo (fn_validar_matching_completo) exigía costos en costos_articulo /
-- costos_pendientes. Con el desacople, los precios viven en precios_proveedor.
-- Se reemplaza para validar contra precios_proveedor.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_validar_matching_completo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tol     int;
  v_precios int;
BEGIN
  IF NEW.estado = 'completado' AND OLD.estado IS DISTINCT FROM 'completado' THEN
    v_tol := LEAST(20, GREATEST(1, COALESCE(NEW.total_filas, 0) / 100));

    IF COALESCE(NEW.filas_procesadas, 0) < COALESCE(NEW.total_filas, 0) - v_tol THEN
      RAISE EXCEPTION 'MATCHING_INCOMPLETO: %/% filas (tol=%)', NEW.filas_procesadas, NEW.total_filas, v_tol;
    END IF;

    -- Mundo 1: los precios procesados viven en precios_proveedor.
    SELECT count(*) INTO v_precios
    FROM public.precios_proveedor
    WHERE importacion_id = NEW.id;

    IF v_precios = 0 AND COALESCE(NEW.total_filas, 0) > 0 THEN
      RAISE EXCEPTION 'PRECIOS_VACIO: importacion % sin precios procesados en precios_proveedor.', NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

-- ROLLBACK
/*
-- Restaurar versión anterior re-ejecutando 20260818000005_fix_trigger_matching_vacio.sql
*/
