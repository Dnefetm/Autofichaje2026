-- SECCIÓN 6.2 y 3.2 - Tablas Faltantes
CREATE TABLE IF NOT EXISTS public.tipos_cambio (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    moneda_origen text NOT NULL,
    moneda_destino text NOT NULL,
    tasa numeric NOT NULL,
    fecha timestamp with time zone DEFAULT now(),
    creado_el timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.proveedor_locks (
    proveedor text PRIMARY KEY,
    locked_at timestamp with time zone DEFAULT now(),
    locked_by uuid
);

CREATE TABLE IF NOT EXISTS public.system_metrics (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    metric_name text NOT NULL,
    metric_value numeric NOT NULL,
    tags jsonb DEFAULT '{}'::jsonb,
    creado_el timestamp with time zone DEFAULT now()
);

-- SECCIÓN 6.7 - fn_revertir_importacion
CREATE OR REPLACE FUNCTION public.fn_revertir_importacion(p_importacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_proveedor text;
BEGIN
    SELECT proveedor INTO v_proveedor FROM importaciones_excel WHERE id = p_importacion_id;
    IF v_proveedor IS NULL THEN
        RAISE EXCEPTION 'Importación no encontrada';
    END IF;

    -- Eliminar los costos generados por esta importacion
    DELETE FROM costos_articulo WHERE importacion_id = p_importacion_id;
    
    -- Eliminar los pendientes generados por esta importacion
    DELETE FROM costos_pendientes WHERE importacion_id = p_importacion_id;

    -- Activar la lista anterior más reciente del proveedor
    UPDATE listas_precios_proveedor
    SET vigente = true, fecha_vigor_hasta = NULL
    WHERE id = (
        SELECT id FROM listas_precios_proveedor 
        WHERE proveedor = v_proveedor AND importacion_id <> p_importacion_id
        ORDER BY importacion_fecha DESC LIMIT 1
    );

    UPDATE importaciones_excel SET estado = 'revertido', ultima_actividad = now() WHERE id = p_importacion_id;
    
    -- Encolar recalculo masivo de los articulos afectados si tenian precio basado en esta importacion
    INSERT INTO precio_recalc_queue (articulo_id)
    SELECT DISTINCT articulo_id FROM costos_articulo WHERE proveedor = v_proveedor
    ON CONFLICT DO NOTHING;
END;
$$;
