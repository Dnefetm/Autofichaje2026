-- =============================================================================
-- v134: fn_guard_completado_importacion acepta precios_proveedor como señal válida
-- =============================================================================
-- Problema: el trigger trg_guard_completado_importacion exige costos_articulo > 0
--           para permitir estado='completado'. El pipeline nuevo de precios
--           (fn_procesar_precios_proveedor) escribe precios_proveedor, NO
--           costos_articulo. Resultado: MATCHING_VACIO bloquea la activación de
--           las listas modernas (Urrea Sep, Victorinox).
--
-- Fix (mínimo, retrocompatible): añadir la comprobación de precios_proveedor.
--   Antes: IF v_costos = 0 THEN RAISE ...
--   Ahora: IF v_costos = 0 AND v_precios = 0 THEN RAISE ...
-- Las listas legacy siguen validando por costos_articulo; las modernas pasan por
-- precios_proveedor. No se debilita ninguna otra validación.
--
-- Revert: re-aplicar la versión previa de fn_guard_completado_importacion
--         (solo costos_articulo).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_guard_completado_importacion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tol int;
  v_costos int;
  v_precios int;
BEGIN
  IF NEW.estado = 'completado' AND OLD.estado IS DISTINCT FROM 'completado' THEN
    v_tol := LEAST(20, GREATEST(1, COALESCE(NEW.total_filas,0) / 100));

    IF COALESCE(NEW.filas_procesadas,0) < COALESCE(NEW.total_filas,0) - v_tol THEN
      RAISE EXCEPTION 'MATCHING_INCOMPLETO: %/% filas (tol=%)', NEW.filas_procesadas, NEW.total_filas, v_tol;
    END IF;

    SELECT count(*) INTO v_costos FROM public.costos_articulo WHERE importacion_id = NEW.id;
    SELECT count(*) INTO v_precios FROM public.precios_proveedor WHERE importacion_id = NEW.id;

    IF v_costos = 0 AND v_precios = 0 AND COALESCE(NEW.total_filas,0) > 0 THEN
      RAISE EXCEPTION 'MATCHING_VACIO: importacion % sin costos ni precios generados (filas_procesadas=%, total_filas=%).', NEW.id, NEW.filas_procesadas, NEW.total_filas;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
