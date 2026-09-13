-- Migración: tabla `usuarios` (login + roles) — Tarea 4 (auth/roles)
-- ADITIVA: no modifica tablas existentes. Idempotente.
-- Conecta auth.users (login Supabase) con las entidades ya existentes:
--   operadores, vendedores, clientes.

CREATE TABLE IF NOT EXISTS public.usuarios (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('admin','vendedor_propio','vendedor_tercero','operador','cliente')),
    operador_id TEXT REFERENCES public.operadores(id) ON DELETE SET NULL,
    vendedor_id UUID REFERENCES public.vendedores(id) ON DELETE SET NULL,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
    activo BOOLEAN NOT NULL DEFAULT true,
    creado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON public.usuarios(rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_operador ON public.usuarios(operador_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_vendedor ON public.usuarios(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_cliente ON public.usuarios(cliente_id);

-- Helper para RLS/middleware: devuelve el rol del usuario autenticado.
CREATE OR REPLACE FUNCTION public.current_rol()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT rol FROM public.usuarios WHERE id = auth.uid() AND activo;
$$;
