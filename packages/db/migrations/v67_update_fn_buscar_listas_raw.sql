DROP FUNCTION IF EXISTS fn_buscar_listas_raw(uuid, text, text, int);
DROP FUNCTION IF EXISTS fn_buscar_listas_raw(uuid, text, text, int, boolean);
DROP FUNCTION IF EXISTS fn_buscar_listas_raw(text, text, text, int, boolean);

CREATE OR REPLACE FUNCTION fn_buscar_listas_raw(
  p_proveedor text,
  p_marca text DEFAULT NULL,
  p_modelo text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_incluir_revertidos boolean DEFAULT false
) RETURNS SETOF listas_precios_raw
LANGUAGE sql STABLE AS $$
  SELECT *
  FROM listas_precios_raw
  WHERE proveedor = p_proveedor
    AND (p_incluir_revertidos OR revertido_at IS NULL)
    AND (
      p_marca IS NULL OR EXISTS (
        SELECT 1 FROM jsonb_each_text(payload) kv
        WHERE lower(kv.key) IN ('marca','brand') AND kv.value ILIKE '%' || p_marca || '%'
      )
    )
    AND (
      p_modelo IS NULL OR EXISTS (
        SELECT 1 FROM jsonb_each_text(payload) kv
        WHERE lower(kv.key) IN ('modelo','model') AND kv.value ILIKE '%' || p_modelo || '%'
      )
    )
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION fn_buscar_listas_raw(text, text, text, int, boolean) TO authenticated, service_role;
