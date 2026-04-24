-- =============================================================================
-- MIGRACIÓN v76: Fix de Permisos session_replication_role
-- Reemplaza el GUC restringido por ALTER TABLE ... DISABLE TRIGGER USER
-- =============================================================================

BEGIN;

-- ====================================================================
-- 1. fn_consolidar_importacion
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_consolidar_importacion(
    p_importacion_id uuid,
    p_proveedor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_totales int := 0;
BEGIN
    SELECT COUNT(*) INTO v_totales FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

    INSERT INTO listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
    SELECT importacion_id, proveedor, fila_num, payload, columnas_guardadas
    FROM listas_precios_raw_staging
    WHERE importacion_id = p_importacion_id;

    DELETE FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

    -- Update status
    UPDATE importaciones_excel
    SET resumen_diff = jsonb_build_object('totales', v_totales, 'nuevos', v_totales, 'modificados', 0, 'eliminados', 0)
    WHERE id = p_importacion_id;

    BEGIN
        -- Desactivar triggers de usuario temporalmente en lugar de session_replication_role
        ALTER TABLE listas_precios_proveedor DISABLE TRIGGER USER;
        ALTER TABLE costos_articulo DISABLE TRIGGER USER;

        UPDATE listas_precios_proveedor SET vigente = false WHERE proveedor = p_proveedor AND vigente = true;

        INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
        VALUES (p_proveedor, p_importacion_id, true, v_totales);

        -- Borrado lógico rápido de costos anteriores
        UPDATE costos_articulo SET vigente = false WHERE proveedor = p_proveedor AND vigente = true;

        -- Reactivar triggers
        ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
        ALTER TABLE costos_articulo ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
        -- Asegurar que se reactivan incluso si hay un error
        ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
        ALTER TABLE costos_articulo ENABLE TRIGGER USER;
        RAISE;
    END;

    UPDATE importaciones_excel SET estado = 'completado'::estado_importacion_excel, ultima_actividad = now() WHERE id = p_importacion_id;

    INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
    VALUES (p_importacion_id, 'CONSOLIDADO', 'Lista de precios actualizada y costos anteriores invalidados.');
END;
$$;


-- ====================================================================
-- 2. fn_consolidar_revision_importacion
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_consolidar_revision_importacion(
    p_importacion_id uuid,
    p_proveedor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_totales int := 0;
BEGIN
    SELECT COUNT(*) INTO v_totales FROM listas_precios_raw WHERE importacion_id = p_importacion_id;

    BEGIN
        ALTER TABLE listas_precios_proveedor DISABLE TRIGGER USER;
        ALTER TABLE costos_articulo DISABLE TRIGGER USER;

        UPDATE listas_precios_proveedor SET vigente = false WHERE proveedor = p_proveedor AND vigente = true;
        INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
        VALUES (p_proveedor, p_importacion_id, true, v_totales);

        UPDATE costos_articulo SET vigente = false WHERE proveedor = p_proveedor AND vigente = true AND importacion_id != p_importacion_id;
        UPDATE costos_articulo SET vigente = true WHERE importacion_id = p_importacion_id AND articulo_id IS NOT NULL;

        ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
        ALTER TABLE costos_articulo ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
        ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
        ALTER TABLE costos_articulo ENABLE TRIGGER USER;
        RAISE;
    END;

    UPDATE importaciones_excel SET estado = 'completado'::estado_importacion_excel, ultima_actividad = now() WHERE id = p_importacion_id;

    INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
    VALUES (p_importacion_id, 'CONSOLIDADO', 'Revisión finalizada y cambios proyectados al catálogo.');
END;
$$;


-- ====================================================================
-- 3. fn_preparar_importacion_revision
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_preparar_importacion_revision(
    p_importacion_id uuid,
    p_proveedor text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_totales int := 0;
BEGIN
    SELECT COUNT(*) INTO v_totales FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

    INSERT INTO listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
    SELECT importacion_id, proveedor, fila_num, payload, columnas_guardadas
    FROM listas_precios_raw_staging
    WHERE importacion_id = p_importacion_id;

    DELETE FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

    UPDATE importaciones_excel
    SET resumen_diff = jsonb_build_object('totales', v_totales, 'nuevos', v_totales, 'modificados', 0, 'eliminados', 0)
    WHERE id = p_importacion_id;

    BEGIN
        ALTER TABLE listas_precios_proveedor DISABLE TRIGGER USER;

        UPDATE listas_precios_proveedor SET vigente = false WHERE proveedor = p_proveedor AND vigente = true;
        INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
        VALUES (p_proveedor, p_importacion_id, true, v_totales);

        ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
    EXCEPTION WHEN OTHERS THEN
        ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
        RAISE;
    END;

    UPDATE importaciones_excel SET estado = 'completado'::estado_importacion_excel, ultima_actividad = now() WHERE id = p_importacion_id;

    INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
    VALUES (p_importacion_id, 'CONSOLIDADO', 'Lista de precios actualizada (Diff omitido por rendimiento).');
END;
$$;


-- ====================================================================
-- 4. fn_watchdog_importaciones
-- ====================================================================
CREATE OR REPLACE FUNCTION public.fn_watchdog_importaciones()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN 
        SELECT id, estado, ultima_actividad FROM importaciones_excel 
        WHERE estado IN ('mapeando', 'procesando') 
          AND ultima_actividad < now() - interval '30 minutes'
    LOOP
        UPDATE importaciones_excel SET estado = 'error', error_mensaje = 'Timeout: El proceso tomó demasiado tiempo o se colgó.' WHERE id = rec.id;
        
        BEGIN
            ALTER TABLE listas_precios_raw DISABLE TRIGGER USER;
            ALTER TABLE costos_articulo DISABLE TRIGGER USER;
            ALTER TABLE matching_jobs DISABLE TRIGGER USER;

            DELETE FROM listas_precios_raw WHERE importacion_id = rec.id;
            DELETE FROM listas_precios_raw_staging WHERE importacion_id = rec.id;
            DELETE FROM costos_articulo WHERE importacion_id = rec.id;
            DELETE FROM matching_jobs WHERE importacion_id = rec.id;

            ALTER TABLE listas_precios_raw ENABLE TRIGGER USER;
            ALTER TABLE costos_articulo ENABLE TRIGGER USER;
            ALTER TABLE matching_jobs ENABLE TRIGGER USER;
        EXCEPTION WHEN OTHERS THEN
            ALTER TABLE listas_precios_raw ENABLE TRIGGER USER;
            ALTER TABLE costos_articulo ENABLE TRIGGER USER;
            ALTER TABLE matching_jobs ENABLE TRIGGER USER;
            RAISE;
        END;
        
        INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
        VALUES (rec.id, 'WATCHDOG', 'Cancelada y limpiada automáticamente por inactividad.');
    END LOOP;
END;
$$;

COMMIT;
