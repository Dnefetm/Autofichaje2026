-- =============================================================================
-- MIGRACIÓN (append-only): renombrar proveedor — TODAS las tablas (8)
-- =============================================================================
-- Corrige la omisión previa: faltaban pricing_rule_v3 y matching_decisiones.
-- Transacción: o se renombra todo o nada. No borra datos.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_renombrar_proveedor(
    p_viejo text,
    p_nuevo text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_viejo IS NULL OR p_nuevo IS NULL OR trim(p_viejo) = '' OR trim(p_nuevo) = '' THEN
        RAISE EXCEPTION 'Los nombres de proveedor no pueden ser nulos ni vacíos';
    END IF;

    UPDATE importaciones_excel        SET proveedor = p_nuevo WHERE proveedor = p_viejo;
    UPDATE listas_precios_proveedor    SET proveedor = p_nuevo WHERE proveedor = p_viejo;
    UPDATE proveedor_articulos_alias   SET proveedor = p_nuevo WHERE proveedor = p_viejo;
    UPDATE costos_pendientes           SET proveedor = p_nuevo WHERE proveedor = p_viejo;
    UPDATE proveedor_configs           SET proveedor = p_nuevo WHERE proveedor = p_viejo;
    UPDATE proveedores                 SET nombre    = p_nuevo WHERE nombre    = p_viejo;
    UPDATE pricing_rule_v3             SET proveedor = p_nuevo WHERE proveedor = p_viejo;
    UPDATE matching_decisiones         SET proveedor = p_nuevo WHERE proveedor = p_viejo;
END;
$$;

COMMIT;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.fn_renombrar_proveedor(text, text);
