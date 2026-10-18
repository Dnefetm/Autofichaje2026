-- 20261028: upsert de feeds complementarios (existencias/SAT) en catalogo_proveedor.
-- NO sobrescribe sku_proveedor (se conserva el literal original que usa el motor de precios).
-- p_origen: 'existencias' actualiza solo stock; 'sat' actualiza solo codigo_sat.
-- Para existencias, además pone stock=0 a los items del proveedor que NO vienen en el feed (agotados).

CREATE OR REPLACE FUNCTION fn_upsert_catalogo_feed(p_proveedor text, p_filas jsonb, p_origen text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_upsert integer;
    v_cero integer := 0;
BEGIN
    WITH filas AS (
        SELECT
            (x->>'proveedor')::text      AS proveedor,
            (x->>'sku_norm')::text       AS sku_norm,
            (x->>'sku_proveedor')::text  AS sku_proveedor,
            NULLIF(x->>'descripcion','') AS descripcion,
            (x->>'stock')::integer       AS stock,
            NULLIF(x->>'codigo_sat','')  AS codigo_sat
        FROM jsonb_array_elements(p_filas) AS x
    )
    INSERT INTO catalogo_proveedor (proveedor, sku_norm, sku_proveedor, descripcion, stock, codigo_sat, origen, actualizado_el)
    SELECT proveedor, sku_norm, sku_proveedor, descripcion, stock, codigo_sat, p_origen, now()
    FROM filas
    ON CONFLICT (proveedor, sku_norm) DO UPDATE SET
        stock         = COALESCE(EXCLUDED.stock, catalogo_proveedor.stock),
        codigo_sat    = COALESCE(EXCLUDED.codigo_sat, catalogo_proveedor.codigo_sat),
        descripcion   = COALESCE(EXCLUDED.descripcion, catalogo_proveedor.descripcion),
        origen        = EXCLUDED.origen,
        actualizado_el = now();

    GET DIAGNOSTICS v_upsert = ROW_COUNT;

    IF p_origen = 'existencias' THEN
        UPDATE catalogo_proveedor cp
        SET stock = 0, actualizado_el = now()
        WHERE cp.proveedor = p_proveedor
          AND cp.stock IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(p_filas) AS x
              WHERE (x->>'sku_norm') = cp.sku_norm
          );
        GET DIAGNOSTICS v_cero = ROW_COUNT;
    END IF;

    RETURN jsonb_build_object('upsert', v_upsert, 'a_cero', v_cero);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_upsert_catalogo_feed(text, jsonb, text) TO authenticated, anon, service_role;
