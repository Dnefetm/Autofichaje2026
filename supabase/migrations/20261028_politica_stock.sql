-- 20261028: política de stock por proveedor + resolución de stock publicable.
-- modos: fijo (dropship), proveedor (fracción del stock del PDF, ej. 1/5), fisico (inventory_snapshot), manual.

CREATE TABLE IF NOT EXISTS politica_stock (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    proveedor text NOT NULL,
    modo text NOT NULL CHECK (modo IN ('fijo', 'proveedor', 'fisico', 'manual')),
    stock_fijo integer,
    fraccion_maxima numeric,            -- ej. 0.2 para publicar 1/5 del stock del proveedor
    activo boolean DEFAULT true,
    actualizado_el timestamptz DEFAULT now(),
    UNIQUE (proveedor)
);

-- Normaliza un SKU igual que skuBaseWurth (colapsa espacios y reduce prefijo 90/91 → 00).
CREATE OR REPLACE FUNCTION fn_sku_norm(p_sku text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN left(s, 2) IN ('90', '91') THEN '00' || substr(s, 3)
        ELSE s
    END
    FROM (SELECT regexp_replace(btrim(p_sku), '\s+', '', 'g') AS s) t;
$$;

GRANT EXECUTE ON FUNCTION fn_sku_norm(text) TO authenticated, anon, service_role;

-- Variante para el publicador: devuelve { stock, modo } solo cuando aplica una política
-- (fijo/proveedor). Si no hay política o es física/manual, devuelve stock=null para que el
-- llamador use el stock físico actual (calculateAvailableStock).
CREATE OR REPLACE FUNCTION fn_stock_publicable(p_articulo_id uuid, p_proveedor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_proveedor text := p_proveedor;
    v_modo text;
    v_stock_fijo integer;
    v_fraccion numeric;
    v_stock integer;
BEGIN
    IF v_proveedor IS NULL THEN
        SELECT pa.proveedor INTO v_proveedor
        FROM proveedor_articulos_alias pa
        WHERE pa.articulo_id = p_articulo_id
        ORDER BY pa.ultima_vez_visto DESC NULLS LAST
        LIMIT 1;
    END IF;

    SELECT modo, stock_fijo, fraccion_maxima
    INTO v_modo, v_stock_fijo, v_fraccion
    FROM politica_stock
    WHERE proveedor = v_proveedor AND activo = true
    LIMIT 1;

    IF v_modo IS NULL OR v_modo IN ('fisico', 'manual') THEN
        RETURN jsonb_build_object('stock', NULL, 'modo', COALESCE(v_modo, 'sin_politica'));
    END IF;

    IF v_modo = 'fijo' THEN
        RETURN jsonb_build_object('stock', GREATEST(0, COALESCE(v_stock_fijo, 0)), 'modo', v_modo);
    END IF;

    IF v_modo = 'proveedor' THEN
        SELECT cp.stock INTO v_stock
        FROM proveedor_articulos_alias pa
        JOIN catalogo_proveedor cp
            ON cp.proveedor = pa.proveedor
            AND cp.sku_norm = fn_sku_norm(pa.modelo_excel)
        WHERE pa.articulo_id = p_articulo_id
        ORDER BY cp.actualizado_el DESC
        LIMIT 1;
        v_stock := GREATEST(0, COALESCE(v_stock, 0));
        RETURN jsonb_build_object(
            'stock',
            CASE WHEN v_stock > 0 THEN GREATEST(1, floor(v_stock * COALESCE(v_fraccion, 0.2))) ELSE 0 END,
            'modo', v_modo
        );
    END IF;

    RETURN jsonb_build_object('stock', NULL, 'modo', v_modo);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_stock_publicable(uuid, text) TO authenticated, anon, service_role;

