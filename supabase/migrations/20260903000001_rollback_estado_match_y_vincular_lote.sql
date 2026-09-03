-- =============================================================================
-- ROLLBACK de 20260903000000_fix_estado_match_y_vincular_lote.sql
-- Restaura las 3 funciones a su versión original (con los bugs), por si el fix
-- causara algún problema. Ejecutar en orden inverso (después del fix).
-- =============================================================================
BEGIN;

-- 1. fn_vincular_lote (original: cast ::UUID)
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

-- 2. fn_tg_promote_pendientes (original: 'completado')
CREATE OR REPLACE FUNCTION public.fn_tg_promote_pendientes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT
        cp.importacion_id, NEW.articulo_id, NEW.articulo_id,
        cp.modelo_excel, cp.marca_excel, cp.codigo_excel, '', '',
        cp.tipo_costo, cp.valor, cp.moneda, 'excel', 100, 'completado', true, false
    FROM costos_pendientes cp
    WHERE cp.proveedor = NEW.proveedor
      AND COALESCE(cp.codigo_excel, '') = COALESCE(NEW.codigo_excel, '')
      AND COALESCE(cp.marca_excel, '') = COALESCE(NEW.marca_excel, '')
      AND COALESCE(cp.modelo_excel, '') = COALESCE(NEW.modelo_excel, '')
      AND cp.resuelto = false
    ON CONFLICT (articulo_id, tipo_costo, fuente) DO UPDATE SET
        valor = EXCLUDED.valor,
        moneda = EXCLUDED.moneda,
        importacion_id = EXCLUDED.importacion_id,
        vigente = EXCLUDED.vigente,
        actualizado_el = now();

    UPDATE costos_pendientes cp
    SET resuelto = true, actualizado_el = now()
    WHERE cp.proveedor = NEW.proveedor
      AND COALESCE(cp.codigo_excel, '') = COALESCE(NEW.codigo_excel, '')
      AND COALESCE(cp.marca_excel, '') = COALESCE(NEW.marca_excel, '')
      AND COALESCE(cp.modelo_excel, '') = COALESCE(NEW.modelo_excel, '')
      AND cp.resuelto = false;

    RETURN NEW;
END;
$$;

-- 3. fn_drain_costos_pendientes_sin_match (original de producción: 'completado')
CREATE OR REPLACE FUNCTION public.fn_drain_costos_pendientes_sin_match()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_row record;
    v_articulo record;
BEGIN
    FOR v_row IN
        SELECT cp.id, cp.importacion_id, cp.proveedor, cp.codigo_excel, cp.marca_excel, cp.modelo_excel, cp.tipo_costo, cp.valor, cp.moneda, alias.articulo_id
        FROM costos_pendientes cp
        JOIN proveedor_articulos_alias alias ON alias.proveedor = cp.proveedor
            AND ((cp.codigo_excel IS NOT NULL AND cp.codigo_excel <> '' AND alias.codigo_excel = cp.codigo_excel)
                 OR ((cp.codigo_excel IS NULL OR cp.codigo_excel = '') AND alias.marca_excel = cp.marca_excel AND alias.modelo_excel = cp.modelo_excel))
        WHERE cp.motivo = 'sin_match' AND cp.resuelto = false
    LOOP
        FOR v_articulo IN
            WITH target AS (SELECT codigo_universal FROM articulos WHERE articulo_id = v_row.articulo_id)
            SELECT a.articulo_id FROM articulos a JOIN target t ON a.codigo_universal = t.codigo_universal
            WHERE a.codigo_universal IS NOT NULL AND a.codigo_universal <> ''
            UNION
            SELECT v_row.articulo_id
        LOOP
            INSERT INTO costos_articulo (
                importacion_id, articulo_id, modelo_excel, marca_excel, codigo_universal_excel,
                tipo_costo, valor, moneda, fuente, estado_match, vigente
            )
            VALUES (
                v_row.importacion_id, v_articulo.articulo_id, v_row.modelo_excel, v_row.marca_excel, v_row.codigo_excel,
                v_row.tipo_costo, v_row.valor, v_row.moneda, 'excel', 'completado', true
            )
            ON CONFLICT (articulo_id, tipo_costo, fuente)
            DO UPDATE SET
                importacion_id = EXCLUDED.importacion_id,
                modelo_excel = EXCLUDED.modelo_excel,
                marca_excel = EXCLUDED.marca_excel,
                codigo_universal_excel = EXCLUDED.codigo_universal_excel,
                valor = EXCLUDED.valor,
                moneda = EXCLUDED.moneda,
                vigente = true,
                estado_match = 'completado',
                actualizado_el = now();

            INSERT INTO jobs (type, payload, priority, status)
            VALUES ('recalc_pricing_bundle', jsonb_build_object('articulo_id', v_articulo.articulo_id), 3, 'pending');
        END LOOP;

        UPDATE costos_pendientes SET resuelto = true WHERE id = v_row.id;
    END LOOP;
END;
$function$;

COMMIT;
