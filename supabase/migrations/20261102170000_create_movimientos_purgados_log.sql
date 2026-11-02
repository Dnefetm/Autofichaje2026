-- Migration: Create movimientos_purgados_log and rollback function
-- Purpose: Reversible traceability log for stock reconciliation purges

CREATE TABLE IF NOT EXISTS public.movimientos_purgados_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tabla_origen TEXT NOT NULL CHECK (tabla_origen IN ('ingresos', 'egresos')),
    registro_id TEXT NOT NULL,
    articulo_id TEXT NOT NULL,
    cantidad INTEGER NOT NULL,
    fecha_movimiento TIMESTAMPTZ,
    guia TEXT,
    origin TEXT,
    motivo_purga TEXT NOT NULL,
    payload_completo JSONB NOT NULL,
    purgado_por TEXT NOT NULL DEFAULT 'reconciliacion_fase2',
    purgado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purgados_articulo ON public.movimientos_purgados_log(articulo_id);
CREATE INDEX IF NOT EXISTS idx_purgados_registro ON public.movimientos_purgados_log(registro_id);

CREATE OR REPLACE FUNCTION public.fn_restaurar_movimiento_purgado(p_log_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    r RECORD;
BEGIN
    SELECT * INTO r FROM public.movimientos_purgados_log WHERE id = p_log_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registro de purga % no encontrado', p_log_id;
    END IF;

    IF r.tabla_origen = 'ingresos' THEN
        INSERT INTO public.ingresos (
            id, articulo_id, cantidad, guia, transportista, tipo_ingreso,
            notas, fecha, operador_id, imagenes, sync_hash, ingreso_id, origin
        )
        VALUES (
            (r.payload_completo->>'id')::uuid,
            r.payload_completo->>'articulo_id',
            (r.payload_completo->>'cantidad')::integer,
            r.payload_completo->>'guia',
            r.payload_completo->>'transportista',
            r.payload_completo->>'tipo_ingreso',
            r.payload_completo->>'notas',
            (r.payload_completo->>'fecha')::timestamptz,
            r.payload_completo->>'operador_id',
            ARRAY(SELECT jsonb_array_elements_text(r.payload_completo->'imagenes')),
            r.payload_completo->>'sync_hash',
            r.payload_completo->>'ingreso_id',
            r.payload_completo->>'origin'
        )
        ON CONFLICT (ingreso_id) DO UPDATE SET cantidad = EXCLUDED.cantidad;
    ELSIF r.tabla_origen = 'egresos' THEN
        INSERT INTO public.egresos (
            id, articulo_id, cantidad, tipo_egreso, importacion_full_id,
            guia, transportista, operador_id, notas, imagenes, sync_hash,
            egreso_id, fecha, origin, estado_envio
        )
        VALUES (
            (r.payload_completo->>'id')::uuid,
            r.payload_completo->>'articulo_id',
            (r.payload_completo->>'cantidad')::integer,
            r.payload_completo->>'tipo_egreso',
            r.payload_completo->>'importacion_full_id',
            r.payload_completo->>'guia',
            r.payload_completo->>'transportista',
            r.payload_completo->>'operador_id',
            r.payload_completo->>'notas',
            ARRAY(SELECT jsonb_array_elements_text(r.payload_completo->'imagenes')),
            r.payload_completo->>'sync_hash',
            r.payload_completo->>'egreso_id',
            (r.payload_completo->>'fecha')::timestamptz,
            r.payload_completo->>'origin',
            COALESCE(r.payload_completo->>'estado_envio', 'entregado')
        )
        ON CONFLICT (egreso_id) DO UPDATE SET cantidad = EXCLUDED.cantidad;
    END IF;

    RETURN TRUE;
END;
$$;
