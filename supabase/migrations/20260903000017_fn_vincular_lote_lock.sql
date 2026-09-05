-- =============================================================================
-- MIGRACIÓN (append-only): fn_vincular_lote con lock anti-carrera
-- =============================================================================
-- El SELECT->INSERT por ítem podía generar 23505 si dos clics corren a la vez.
-- Se añade pg_advisory_xact_lock por proveedor para serializar ejecuciones.
-- Idempotente (CREATE OR REPLACE). No cambia el comportamiento normal.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_vincular_lote(p_proveedor TEXT, p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_item JSONB;
    v_codigo_excel TEXT;
    v_modelo_excel TEXT;
    v_marca_excel TEXT;
    v_articulo_id TEXT;
    v_existing_id UUID;
BEGIN
    -- Serializa por proveedor: evita carrera de doble clic (23505 espurio).
    PERFORM pg_advisory_xact_lock(hashtext('fn_vincular_lote_' || p_proveedor));

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_codigo_excel := NULLIF(TRIM(v_item->>'codigo_excel'), '');
        v_modelo_excel := NULLIF(TRIM(v_item->>'modelo_excel'), '');
        v_marca_excel  := NULLIF(TRIM(v_item->>'marca_excel'), '');
        v_articulo_id  := NULLIF(TRIM(v_item->>'articulo_id'), '');

        IF v_articulo_id IS NULL THEN
            RAISE EXCEPTION 'fn_vincular_lote: articulo_id vacio en item %', v_item;
        END IF;

        v_existing_id := NULL;

        IF v_codigo_excel IS NOT NULL THEN
            SELECT id INTO v_existing_id FROM proveedor_articulos_alias
            WHERE proveedor = p_proveedor AND codigo_excel = v_codigo_excel LIMIT 1;
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

COMMIT;

-- ROLLBACK: re-aplicar la versión de 20260903000000 (sin advisory lock).
