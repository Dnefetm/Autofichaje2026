BEGIN;

CREATE OR REPLACE FUNCTION public.fn_drain_costos_pendientes_sin_match()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Utilizar CTEs para hacer operaciones masivas (Bulk / Set-Based)
    -- Esto elimina el problema N+1 y el límite de timeout
    WITH pending AS (
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
    ),
    ins_costos AS (
        -- 1. Insertar todos los costos y actualizar vigentes en un solo comando
        INSERT INTO costos_articulo (
            importacion_id, articulo_id, modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
            tipo_costo, valor, moneda, fuente, estado_match, vigente, incluye_iva
        )
        SELECT 
            p.importacion_id, p.articulo_id, p.modelo_excel, p.marca_excel, p.codigo_excel, p.nombre_excel, p.nombre_excel,
            p.tipo_costo, p.valor, p.moneda_excel, 'excel', 'completado', true, p.incluye_iva
        FROM pending p
        ON CONFLICT (importacion_id, tipo_costo, modelo_excel, marca_excel, valor) 
        DO UPDATE SET 
            vigente = true
    ),
    upd_pendientes AS (
        -- 2. Marcar como resueltos masivamente
        UPDATE costos_pendientes cp
        SET resuelto = true, 
            resuelto_en = now(), 
            resuelto_por_articulo_id = p.articulo_id 
        FROM pending p
        WHERE cp.id = p.id
    )
    -- 3. Encolar los recalculos masivamente eliminando los inner loops
    INSERT INTO jobs (type, payload, priority, status)
    SELECT DISTINCT 'recalc_pricing_bundle', jsonb_build_object('articulo_id', COALESCE(a.articulo_id, p.articulo_id)), 3, 'pending'
    FROM pending p
    LEFT JOIN articulos target ON target.articulo_id = p.articulo_id
    LEFT JOIN articulos a ON a.codigo_universal = target.codigo_universal AND a.codigo_universal IS NOT NULL AND a.codigo_universal <> '';

END;
$$;

COMMIT;
