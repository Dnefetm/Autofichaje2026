-- 20261028: sincroniza los precios vigentes de un proveedor desde precios_proveedor
-- hacia catalogo_proveedor (consolidado precio+stock+SAT). Pivotea tipo_costo en columnas
-- y corrige sku_proveedor a la base (si un feed de existencias insertó antes el prefijo 90/91).

CREATE OR REPLACE FUNCTION fn_sync_catalogo_desde_precios(p_proveedor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer;
BEGIN
    WITH vigentes AS (
        SELECT
            pp.proveedor,
            pp.sku_proveedor,
            fn_sku_norm(pp.sku_proveedor) AS sku_norm,
            MAX(pp.codigo_barra) FILTER (WHERE pp.codigo_barra IS NOT NULL) AS codigo_barra,
            MAX(pp.descripcion) AS descripcion,
            MAX(pp.marca) AS marca,
            MAX(pp.codigo_sat) FILTER (WHERE pp.codigo_sat IS NOT NULL) AS codigo_sat,
            MAX(pp.valor) FILTER (WHERE pp.tipo_costo = 'distribuidor') AS precio_distribuidor,
            MAX(pp.valor) FILTER (WHERE pp.tipo_costo = 'subdistribuidor') AS precio_subdistribuidor,
            MAX(pp.tipo_costo) AS tipo_costo
        FROM precios_proveedor pp
        WHERE pp.proveedor = p_proveedor
          AND pp.vigente = true
        GROUP BY pp.proveedor, pp.sku_proveedor
    )
    INSERT INTO catalogo_proveedor (
        proveedor, sku_proveedor, sku_norm, codigo_barra, descripcion, marca,
        codigo_sat, precio_distribuidor, precio_subdistribuidor, tipo_costo,
        vigente, origen, actualizado_el
    )
    SELECT
        proveedor, sku_proveedor, sku_norm, codigo_barra, descripcion, marca,
        codigo_sat, precio_distribuidor, precio_subdistribuidor, tipo_costo,
        true, 'precios', now()
    FROM vigentes
    ON CONFLICT (proveedor, sku_norm) DO UPDATE SET
        sku_proveedor         = EXCLUDED.sku_proveedor,
        codigo_barra          = COALESCE(EXCLUDED.codigo_barra, catalogo_proveedor.codigo_barra),
        descripcion           = COALESCE(EXCLUDED.descripcion, catalogo_proveedor.descripcion),
        marca                 = COALESCE(EXCLUDED.marca, catalogo_proveedor.marca),
        codigo_sat            = COALESCE(EXCLUDED.codigo_sat, catalogo_proveedor.codigo_sat),
        precio_distribuidor   = COALESCE(EXCLUDED.precio_distribuidor, catalogo_proveedor.precio_distribuidor),
        precio_subdistribuidor = COALESCE(EXCLUDED.precio_subdistribuidor, catalogo_proveedor.precio_subdistribuidor),
        tipo_costo            = COALESCE(EXCLUDED.tipo_costo, catalogo_proveedor.tipo_costo),
        vigente               = true,
        actualizado_el        = now();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('sincronizadas', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION fn_sync_catalogo_desde_precios(text) TO authenticated, anon, service_role;
