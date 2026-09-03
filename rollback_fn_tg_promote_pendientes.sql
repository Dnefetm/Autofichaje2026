-- ROLLBACK: restaura fn_tg_promote_pendientes al valor original ('completado').
-- Úsese solo si el fix_fn_tg_promote_pendientes.sql causara algún problema.
CREATE OR REPLACE FUNCTION public.fn_tg_promote_pendientes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT
        cp.importacion_id, NEW.articulo_id, NEW.articulo_id,
        cp.modelo_excel, cp.marca_excel, cp.codigo_excel, '', '',
        cp.tipo_costo, cp.valor, cp.moneda, 'excel', 100, 'completado', true, false
    FROM costos_pendientes cp
    WHERE cp.proveedor = NEW.proveedor
      AND COALESCE(cp.codigo_excel, '') = COALESCE(NEW.codigo_excel, '')
      AND COALESCE(cp.marca_excel, '') = COALESCE(NEW.marca_excel, '')
      AND COALESCE(cp.modelo_excel, '') = COALESCE(NEW.modelo_excel, '')
      AND cp.resuelto = false
    ON CONFLICT (articulo_id, tipo_costo, fuente) DO UPDATE SET
        valor = EXCLUDED.valor,
        moneda = EXCLUDED.moneda,
        importacion_id = EXCLUDED.importacion_id,
        vigente = EXCLUDED.vigente,
        actualizado_el = now();

    UPDATE costos_pendientes cp
    SET resuelto = true, actualizado_el = now()
    WHERE cp.proveedor = NEW.proveedor
      AND COALESCE(cp.codigo_excel, '') = COALESCE(NEW.codigo_excel, '')
      AND COALESCE(cp.marca_excel, '') = COALESCE(NEW.marca_excel, '')
      AND COALESCE(cp.modelo_excel, '') = COALESCE(NEW.modelo_excel, '')
      AND cp.resuelto = false;

    RETURN NEW;
END;
$$;
