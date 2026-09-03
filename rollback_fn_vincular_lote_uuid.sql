-- =============================================================================
-- ROLLBACK: restaura fn_vincular_lote a su versión original (con el cast UUID)
-- =============================================================================
-- Úsese SOLO si el fix_fn_vincular_lote_uuid.sql causara algún problema.
-- Esta es la versión anterior exacta (la que estaba en producción antes del fix).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_vincular_lote(p_proveedor TEXT, p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item JSONB;
    v_codigo_excel TEXT;
    v_modelo_excel TEXT;
    v_marca_excel TEXT;
    v_articulo_id UUID;
    v_existing_id UUID;
BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_codigo_excel := NULLIF(TRIM(v_item->>'codigo_excel'), '');
        v_modelo_excel := NULLIF(TRIM(v_item->>'modelo_excel'), '');
        v_marca_excel  := NULLIF(TRIM(v_item->>'marca_excel'), '');
        v_articulo_id  := (v_item->>'articulo_id')::UUID;
        v_existing_id  := NULL;

        -- Buscar por código exacto si existe
        IF v_codigo_excel IS NOT NULL THEN
            SELECT id INTO v_existing_id FROM proveedor_articulos_alias
            WHERE proveedor = p_proveedor AND codigo_excel = v_codigo_excel LIMIT 1;
        -- Si no, buscar por marca y modelo
        ELSIF v_modelo_excel IS NOT NULL AND v_marca_excel IS NOT NULL THEN
            SELECT id INTO v_existing_id FROM proveedor_articulos_alias
            WHERE proveedor = p_proveedor AND marca_excel = v_marca_excel AND modelo_excel = v_modelo_excel LIMIT 1;
        END IF;

        IF v_existing_id IS NOT NULL THEN
            UPDATE proveedor_articulos_alias
            SET articulo_id = v_articulo_id,
                locked = true,
                locked_at = now(),
                ultima_vez_visto = now(),
                estado_proveedor = 'activo'
            WHERE id = v_existing_id;
        ELSE
            INSERT INTO proveedor_articulos_alias (proveedor, codigo_excel, modelo_excel, marca_excel, articulo_id, locked, locked_at, ultima_vez_visto, estado_proveedor)
            VALUES (p_proveedor, v_codigo_excel, v_modelo_excel, v_marca_excel, v_articulo_id, true, now(), now(), 'activo');
        END IF;
    END LOOP;
END;
$$;
