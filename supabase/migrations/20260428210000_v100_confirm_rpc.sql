-- v100 — RPC que cierra el feedback loop: marca confirmadas + dispara consolidación
ALTER TABLE public.matching_decisiones
  ADD COLUMN IF NOT EXISTS confirmado_at timestamptz;

CREATE OR REPLACE FUNCTION public.fn_confirmar_matching_decisiones(
  _importacion_id uuid,
  _decisiones     jsonb   -- formato: [{"id":"<uuid>","articulo_id":"<text>"}, ...]
) RETURNS TABLE(decisiones_confirmadas int, alias_aprendidos int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _confirmadas int := 0;
  _alias_pre   int;
  _alias_post  int;
BEGIN
  -- 1) Marcar confirmadas con su articulo_id_final
  WITH payload AS (
    SELECT (e->>'id')::uuid          AS id,
           NULLIF(e->>'articulo_id','') AS articulo_id
    FROM jsonb_array_elements(_decisiones) e
  )
  UPDATE public.matching_decisiones md
     SET confirmado          = true,
         articulo_id_final   = p.articulo_id,
         confirmado_at       = now()
    FROM payload p
   WHERE md.id = p.id
     AND md.importacion_id = _importacion_id;
  GET DIAGNOSTICS _confirmadas = ROW_COUNT;

  -- 2) Disparar la consolidación (UPSERT al diccionario + propagación de costos)
  SELECT COUNT(*) INTO _alias_pre  FROM public.proveedor_articulos_alias;
  PERFORM public.fn_consolidar_matching_decisiones(_importacion_id);
  SELECT COUNT(*) INTO _alias_post FROM public.proveedor_articulos_alias;

  RETURN QUERY SELECT _confirmadas, (_alias_post - _alias_pre);
END $$;

REVOKE ALL ON FUNCTION public.fn_confirmar_matching_decisiones(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_confirmar_matching_decisiones(uuid, jsonb)
  TO authenticated, service_role;
