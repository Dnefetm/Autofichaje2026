BEGIN;

CREATE OR REPLACE FUNCTION public.fn_drain_costos_pendientes_sin_match()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_row record;
    v_articulo record;
BEGIN
    -- Iterar sobre costos pendientes que ahora tengan un match en el diccionario de alias
    FOR v_row IN 
        SELECT 
            cp.id, 
            cp.importacion_id, 
            cp.proveedor, 
            cp.codigo_excel, 
            cp.marca_excel, 
            cp.modelo_excel, 
            cp.tipo_costo, 
            cp.valor, 
            cp.incluye_iva, 
            cp.moneda_excel, 
            cp.nombre_excel, 
            alias.articulo_id
        FROM costos_pendientes cp
        JOIN proveedor_articulos_alias alias 
            ON alias.proveedor = cp.proveedor
           AND (
             (cp.codigo_excel IS NOT NULL AND cp.codigo_excel <> '' AND alias.codigo_excel = cp.codigo_excel) OR
             ((cp.codigo_excel IS NULL OR cp.codigo_excel = '') AND alias.marca_excel = cp.marca_excel AND alias.modelo_excel = cp.modelo_excel)
           )
        WHERE cp.motivo = 'sin_match' 
          AND cp.resuelto = false
    LOOP
        -- 1. Actualizar costos_articulo (propagando el costo)
        INSERT INTO costos_articulo (
            importacion_id, articulo_id, modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
            tipo_costo, valor, moneda, fuente, estado_match, vigente, incluye_iva
        )
        VALUES (
            v_row.importacion_id, v_row.articulo_id, v_row.modelo_excel, v_row.marca_excel, v_row.codigo_excel, v_row.nombre_excel, v_row.nombre_excel,
            v_row.tipo_costo, v_row.valor, v_row.moneda_excel, 'excel', 'completado', true, v_row.incluye_iva
        )
        ON CONFLICT (importacion_id, tipo_costo, modelo_excel, marca_excel, valor) 
        DO UPDATE SET 
            vigente = true;

        -- 2. Marcar como resuelto
        UPDATE costos_pendientes 
        SET resuelto = true, 
            resuelto_en = now(), 
            resuelto_por_articulo_id = v_row.articulo_id 
        WHERE id = v_row.id;

        -- 3. Propagar a duplicados de GTIN y encolar recalculos
        FOR v_articulo IN
            WITH target AS (
                SELECT codigo_universal FROM articulos WHERE articulo_id = v_row.articulo_id
            )
            SELECT a.articulo_id 
            FROM articulos a 
            JOIN target t ON a.codigo_universal = t.codigo_universal 
            WHERE a.codigo_universal IS NOT NULL AND a.codigo_universal <> ''
            UNION 
            SELECT v_row.articulo_id -- En caso de que no tenga GTIN
        LOOP
            INSERT INTO jobs (type, payload, priority, status)
            VALUES ('recalc_pricing_bundle', jsonb_build_object('articulo_id', v_articulo.articulo_id), 3, 'pending');
        END LOOP;
    END LOOP;
END;
$$;

-- Descomentar y ejecutar como superuser para habilitar el cron:
-- SELECT cron.schedule('drain_costos_15min', '*/15 * * * *', 'SELECT public.fn_drain_costos_pendientes_sin_match()');

COMMIT;
