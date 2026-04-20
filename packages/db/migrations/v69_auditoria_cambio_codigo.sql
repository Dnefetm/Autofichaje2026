-- Migración para crear tabla de auditoría de cambios de código universal (Fase 3.5)
CREATE TABLE IF NOT EXISTS public.auditoria_codigo_universal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor TEXT NOT NULL,
    codigo_anterior TEXT,
    codigo_nuevo TEXT NOT NULL,
    articulo_id TEXT NOT NULL,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    creado_por TEXT NOT NULL DEFAULT 'sistema'
);

-- RLS
ALTER TABLE public.auditoria_codigo_universal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auditoria_codigo_universal_sel"
    ON public.auditoria_codigo_universal FOR SELECT
    USING (true);

CREATE POLICY "auditoria_codigo_universal_ins"
    ON public.auditoria_codigo_universal FOR INSERT
    WITH CHECK (true);
