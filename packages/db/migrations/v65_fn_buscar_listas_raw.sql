CREATE OR REPLACE FUNCTION fn_buscar_listas_raw(
  p_proveedor text,
  p_marca text DEFAULT NULL,
  p_modelo text DEFAULT NULL,
  p_limit int DEFAULT 50
) RETURNS SETOF listas_precios_raw
LANGUAGE sql STABLE AS $$
  SELECT *
  FROM listas_precios_raw
  WHERE proveedor = p_proveedor
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

GRANT EXECUTE ON FUNCTION fn_buscar_listas_raw(text, text, text, int) TO authenticated, service_role;
