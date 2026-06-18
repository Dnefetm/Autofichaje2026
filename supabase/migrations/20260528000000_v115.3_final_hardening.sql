-- Migration: v115.3_final_hardening
-- Fecha: 2026-05-28
-- Propósito: 
-- 1. Hardening de search_path en las funciones de trabajo reales para cerrar la vulnerabilidad de hijacking.
-- 2. Asignar un statement_timeout adecuado al wrapper de chunking para evitar runaways.

BEGIN;

ALTER FUNCTION public.fn_match_precios_v2(uuid, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_match_precios_v2_chunked(uuid, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_match_precios_v2_chunked(uuid, integer) SET statement_timeout = '600s';

COMMIT;
