-- Migration: v115.2_security_and_shim
-- Fecha: 2026-05-26
-- Propósito: 
-- 1. Reemplazar la sobrecarga original fn_match_precios_v2(uuid) con un shim que delega a la nueva firma (uuid, boolean).
-- 2. Revocar permisos de ejecución a PUBLIC y anon para las 3 funciones.
-- 3. Otorgar permisos de ejecución solo a authenticated y service_role.
-- 4. Asegurar RLS en listas_precios_raw_staging_backup si existe.
-- 5. Hardening de search_path en el shim.

BEGIN;

-- 1. Crear el shim para backwards compatibility con search_path seguro
CREATE OR REPLACE FUNCTION public.fn_match_precios_v2(p_importacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Llama a la nueva implementación indicando finalizar=true para mantener compatibilidad
  PERFORM public.fn_match_precios_v2(p_importacion_id, true);
END;
$$;

COMMENT ON FUNCTION public.fn_match_precios_v2(uuid) IS
  'Shim de backwards-compat. Delega a fn_match_precios_v2(uuid, boolean) con p_finalizar=true. Desde v115.2.';

-- 2. Revocar permisos por defecto (PUBLIC) y a anon explícitamente
REVOKE EXECUTE ON FUNCTION public.fn_match_precios_v2(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_match_precios_v2(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_match_precios_v2_chunked(uuid, integer) FROM PUBLIC, anon;

-- 3. Otorgar permisos estrictamente a roles seguros
GRANT EXECUTE ON FUNCTION public.fn_match_precios_v2(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_match_precios_v2(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_match_precios_v2_chunked(uuid, integer) TO authenticated, service_role;

-- 4. Hardening de la tabla de backup (si es que existe en este momento)
DO $$ BEGIN
  IF to_regclass('public.listas_precios_raw_staging_backup') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.listas_precios_raw_staging_backup ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.listas_precios_raw_staging_backup FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

COMMIT;
