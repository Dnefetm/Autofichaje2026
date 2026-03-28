-- v39c_funciones_auxiliares_fichas.sql
-- Funciones auxiliares para vincular/desvincular/eliminar fichas técnicas.
-- EJECUTAR EN: Supabase SQL Editor (proyecto ryxdqnzyvnrwalylqyvm)
-- REQUIERE: v39b ejecutado (fichas_tecnicas soporta articulo_id NULL)

-- ── 1. vincular_ficha ─────────────────────────────────────────────────────────
-- Vincula una ficha existente (en modo draft o desvinculada) a un artículo del catálogo.
-- Uso: SELECT vincular_ficha('uuid-ficha', 'ARTICULO-ID');
CREATE OR REPLACE FUNCTION vincular_ficha(
    p_ficha_id    uuid,
    p_articulo_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM fichas_tecnicas WHERE id = p_ficha_id) THEN
        RAISE EXCEPTION 'Ficha % no existe', p_ficha_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM articulos WHERE articulo_id = p_articulo_id) THEN
        RAISE EXCEPTION 'Artículo % no existe en catálogo', p_articulo_id;
    END IF;

    UPDATE fichas_tecnicas
    SET articulo_id = p_articulo_id
    WHERE id = p_ficha_id;

    RETURN jsonb_build_object(
        'ok',          true,
        'ficha_id',    p_ficha_id,
        'articulo_id', p_articulo_id
    );
END;
$$;

-- ── 2. desvincular_ficha ──────────────────────────────────────────────────────
-- Desvincula una ficha de su artículo sin borrar nada.
-- La ficha pasa a modo draft (articulo_id = NULL).
-- Uso: SELECT desvincular_ficha('uuid-ficha');
CREATE OR REPLACE FUNCTION desvincular_ficha(
    p_ficha_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM fichas_tecnicas WHERE id = p_ficha_id) THEN
        RAISE EXCEPTION 'Ficha % no existe', p_ficha_id;
    END IF;

    UPDATE fichas_tecnicas
    SET articulo_id = NULL
    WHERE id = p_ficha_id;

    RETURN jsonb_build_object(
        'ok',          true,
        'ficha_id',    p_ficha_id,
        'articulo_id', null
    );
END;
$$;

-- ── 3. eliminar_ficha_completa ────────────────────────────────────────────────
-- Borra una ficha con todas sus extracciones (ficha_extracciones).
-- No borra fuentes_documento (quedan como auditoría de OCR).
-- No borra el artículo vinculado (solo desvincula el FK).
-- Uso: SELECT eliminar_ficha_completa('uuid-ficha');
CREATE OR REPLACE FUNCTION eliminar_ficha_completa(
    p_ficha_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_extracciones int;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM fichas_tecnicas WHERE id = p_ficha_id) THEN
        RAISE EXCEPTION 'Ficha % no existe', p_ficha_id;
    END IF;

    DELETE FROM ficha_extracciones WHERE ficha_tecnica_id = p_ficha_id;
    GET DIAGNOSTICS v_extracciones = ROW_COUNT;

    DELETE FROM fichas_tecnicas WHERE id = p_ficha_id;

    RETURN jsonb_build_object(
        'ok',                      true,
        'ficha_id',                p_ficha_id,
        'extracciones_eliminadas', v_extracciones
    );
END;
$$;

-- ── Verificación ──────────────────────────────────────────────────────────────
-- Después de ejecutar, verificar que las funciones existen:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public'
--   AND routine_name IN ('vincular_ficha','desvincular_ficha','eliminar_ficha_completa');
