-- =============================================================================
-- MIGRACIÓN (append-only): RPC para insertar raw desde el navegador (parseo en cliente)
-- =============================================================================
-- Problema: la Edge Function moría por CPU Time exceeded (límite de 2s del plan
--           Free de Supabase) al parsear 15,401 filas. La solución es parsear en
--           el NAVEGADOR (CPU libre) y mandar los chunks ya limpios a Postgres.
--
-- Fix: exponer un RPC SECURITY DEFINER que inserte un lote de filas en
--      listas_precios_raw. El navegador llama este RPC por chunks; Postgres no
--      tiene el límite de 2s de CPU de las Edge Functions.
--
-- Idempotente (CREATE OR REPLACE). Aditivo.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_insertar_raw_lote(
  p_importacion_id uuid,
  p_proveedor text,
  p_filas jsonb
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int := 0;
BEGIN
  INSERT INTO public.listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
  SELECT
    p_importacion_id,
    p_proveedor,
    (f->>'fila_num')::int,
    f->'payload',
    COALESCE(ARRAY(SELECT jsonb_array_elements_text(f->'columnas_guardadas')), ARRAY[]::text[])
  FROM jsonb_array_elements(p_filas) f;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_insertar_raw_lote(uuid, text, jsonb) TO authenticated, anon, service_role;

COMMIT;

-- =============================================================================
-- ROLLBACK
-- =============================================================================
/*
BEGIN;
DROP FUNCTION IF EXISTS public.fn_insertar_raw_lote(uuid, text, jsonb);
COMMIT;
*/
