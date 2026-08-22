-- =============================================================================
-- MIGRACIÓN: Fix al Trigger de Validación de Matching (MATCHING_VACIO)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_validar_matching_completo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tol int;
    v_costos int;
    v_pendientes int;
BEGIN
    IF NEW.estado = 'completado' AND OLD.estado IS DISTINCT FROM 'completado' THEN
        -- Validar que filas_procesadas >= total_filas (con 1% de tolerancia o max 20)
        v_tol := LEAST(20, GREATEST(1, COALESCE(NEW.total_filas,0) / 100));
        
        IF COALESCE(NEW.filas_procesadas,0) < COALESCE(NEW.total_filas,0) - v_tol THEN
            RAISE EXCEPTION 'MATCHING_INCOMPLETO: %/% filas (tol=%)', NEW.filas_procesadas, NEW.total_filas, v_tol;
        END IF;

        -- Validar que sí se escribió ALGO (ya sea exacto o pendiente de revisión)
        SELECT count(*) INTO v_costos FROM public.costos_articulo WHERE importacion_id = NEW.id;
        SELECT count(*) INTO v_pendientes FROM public.costos_pendientes WHERE importacion_id = NEW.id;

        IF v_costos = 0 AND v_pendientes = 0 AND COALESCE(NEW.total_filas,0) > 0 THEN
            RAISE EXCEPTION 'MATCHING_VACIO: importacion % sin costos generados (filas_procesadas=%, total_filas=%). El matcher no escribio nada en costos_articulo ni en pendientes.', NEW.id, NEW.filas_procesadas, NEW.total_filas;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- Asegurar que el trigger usa la función (por si acaso el nombre cambió)
DROP TRIGGER IF EXISTS trg_validar_matching_completo ON public.importaciones_excel;
CREATE TRIGGER trg_validar_matching_completo
BEFORE UPDATE ON public.importaciones_excel
FOR EACH ROW
EXECUTE FUNCTION public.fn_validar_matching_completo();
