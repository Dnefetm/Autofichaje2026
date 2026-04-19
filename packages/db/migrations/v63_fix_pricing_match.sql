-- =============================================================================
-- MIGRACIÓN v63: Corrección severa del Matching de Precios
-- =============================================================================

DROP FUNCTION IF EXISTS fn_match_articulo_proveedor(text, text, text);

CREATE OR REPLACE FUNCTION fn_match_articulo_proveedor(
    p_modelo  text,
    p_marca   text DEFAULT NULL,
    p_codigo  text DEFAULT NULL
)
RETURNS TABLE (
    articulo_id      text,
    nombre           text,
    marca            text,
    modelo           text,
    codigo_universal text,
    puntaje_match    numeric,
    metodo_match     text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_query text;
BEGIN
    -- ── Paso 1: Intentar buscar por el Código Universal si viene provisto ──
    IF p_codigo IS NOT NULL AND trim(p_codigo) != '' THEN

        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            a.codigo_universal::text,
            -- Evaluación Restrictiva de Score
            CASE 
               WHEN (p_marca IS NOT NULL AND trim(p_marca) != '' AND lower(trim(a.marca)) = lower(trim(p_marca))) 
                AND (p_modelo IS NOT NULL AND trim(p_modelo) != '' AND similarity(lower(a.modelo), lower(p_modelo)) > 0.85) 
               THEN 100::numeric
               ELSE 85::numeric -- Duda Fuerte, hay desajustes en campos textuales pero el código cruza
            END AS puntaje_match,
            
            CASE 
               WHEN (p_marca IS NOT NULL AND trim(p_marca) != '' AND lower(trim(a.marca)) = lower(trim(p_marca))) 
                AND (p_modelo IS NOT NULL AND trim(p_modelo) != '' AND similarity(lower(a.modelo), lower(p_modelo)) > 0.85) 
               THEN 'exacto_triple'::text
               ELSE 'codigo_exacto_incompleto'::text
            END AS metodo_match
            
        FROM articulos a
        WHERE a.activo = true
          AND a.codigo_universal = p_codigo
        LIMIT 5;

        IF FOUND THEN
            RETURN;
        END IF;

    END IF;

    -- ── Paso 2: Fuzzy con pg_trgm sobre marca + modelo ────────────────────
    v_query := trim(COALESCE(p_marca, '') || ' ' || COALESCE(p_modelo, ''));
    v_query := trim(regexp_replace(v_query, '\s+', ' ', 'g'));

    IF v_query = '' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        a.articulo_id::text,
        a.nombre::text,
        a.marca::text,
        a.modelo::text,
        a.codigo_universal::text,
        round(
            (similarity(
                lower(a.marca || ' ' || a.modelo),
                lower(v_query)
            ) * 95)::numeric, -- El fuzzy NUNCA retorna 100
            1
        )                      AS puntaje_match,
        'fuzzy_trgm'::text     AS metodo_match
    FROM articulos a
    WHERE a.activo = true
      AND similarity(
          lower(a.marca || ' ' || a.modelo),
          lower(v_query)
      ) > 0.2
    ORDER BY similarity(
        lower(a.marca || ' ' || a.modelo),
        lower(v_query)
    ) DESC
    LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_match_articulo_proveedor(text, text, text) TO anon, authenticated, service_role;
