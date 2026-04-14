-- =============================================================================
-- MIGRACIÓN v58: Matching con pg_trgm + columnas de trazabilidad en costos_articulo
-- =============================================================================
-- PROPÓSITO:
--   1. Agregar marca_excel y codigo_excel a costos_articulo para trazabilidad completa
--   2. Crear índice GIN sobre articulos (marca || ' ' || modelo) para pg_trgm
--   3. Crear función RPC fn_match_articulo_proveedor que el backend usa por fila:
--      - Primero intenta match exacto por código universal (score 100)
--      - Fallback: fuzzy similarity() de marca+modelo del Excel contra marca+modelo del catálogo
-- =============================================================================

-- ─── 1. Columnas de trazabilidad en costos_articulo ─────────────────────────

ALTER TABLE costos_articulo
  ADD COLUMN IF NOT EXISTS marca_excel  text,
  ADD COLUMN IF NOT EXISTS codigo_excel text;

COMMENT ON COLUMN costos_articulo.marca_excel  IS 'Valor crudo de la columna Marca del Excel importado';
COMMENT ON COLUMN costos_articulo.codigo_excel IS 'Valor crudo de la columna Código Universal del Excel (UPC/EAN/código de barras)';

-- ─── 2. Índice GIN para pg_trgm en artículos ────────────────────────────────
-- Acelera dramatically las búsquedas de similaridad sobre marca + modelo.
-- Requiere pg_trgm (habilitado, v1.6).

CREATE INDEX IF NOT EXISTS idx_articulos_marca_modelo_trgm
    ON articulos
    USING gin ((lower(marca || ' ' || modelo)) gin_trgm_ops);

-- Índice adicional para match exacto por modelo/código
CREATE INDEX IF NOT EXISTS idx_articulos_modelo_lower
    ON articulos (lower(trim(modelo)));

-- ─── 3. Función RPC: match de una fila del Excel contra catálogo ─────────────
-- Llamada desde el backend por cada fila del Excel.
-- Prioridades:
--   1. Match exacto por código_excel → score 100, metodo 'codigo_exacto'
--   2. Fuzzy similarity(marca+modelo Excel, marca+modelo catálogo) → score 0-100, metodo 'fuzzy_trgm'
-- Retorna máximo 1 fila (el mejor candidato).

CREATE OR REPLACE FUNCTION fn_match_articulo_proveedor(
    p_modelo  text,
    p_marca   text DEFAULT NULL,
    p_codigo  text DEFAULT NULL
)
RETURNS TABLE (
    articulo_id   text,
    nombre        text,
    marca         text,
    modelo        text,
    puntaje_match numeric,
    metodo_match  text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_query text;
BEGIN
    -- ── Paso 1: Match exacto por código universal ──────────────────────────
    -- Compara el código del Excel contra articulos.modelo (donde suelen vivir las referencias).
    IF p_codigo IS NOT NULL AND trim(p_codigo) != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            100::numeric       AS puntaje_match,
            'codigo_exacto'::text AS metodo_match
        FROM articulos a
        WHERE a.activo = true
          AND lower(trim(a.modelo)) = lower(trim(p_codigo))
        LIMIT 1;

        -- Si encontró match exacto, no continúa con fuzzy
        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    -- ── Paso 2: Fuzzy con pg_trgm sobre marca + modelo ────────────────────
    -- Construye el query de búsqueda combinando marca y modelo del Excel
    v_query := trim(COALESCE(p_marca, '') || ' ' || COALESCE(p_modelo, ''));
    v_query := trim(regexp_replace(v_query, '\s+', ' ', 'g'));  -- normalizar espacios

    IF v_query = '' THEN
        RETURN;  -- nada que comparar
    END IF;

    RETURN QUERY
    SELECT
        a.articulo_id::text,
        a.nombre::text,
        a.marca::text,
        a.modelo::text,
        round(
            (similarity(
                lower(a.marca || ' ' || a.modelo),
                lower(v_query)
            ) * 100)::numeric,
            1
        )                      AS puntaje_match,
        'fuzzy_trgm'::text     AS metodo_match
    FROM articulos a
    WHERE a.activo = true
      AND similarity(
          lower(a.marca || ' ' || a.modelo),
          lower(v_query)
      ) > 0.2   -- umbral mínimo para no retornar basura
    ORDER BY similarity(
        lower(a.marca || ' ' || a.modelo),
        lower(v_query)
    ) DESC
    LIMIT 1;
END;
$$;

-- Dar permisos a anon y authenticated (mismo patrón que otras funciones del proyecto)
GRANT EXECUTE ON FUNCTION fn_match_articulo_proveedor(text, text, text) TO anon, authenticated, service_role;

-- ─── Verificación ─────────────────────────────────────────────────────────────
-- Test rápido (ajusta los valores a tu catálogo):
-- SELECT * FROM fn_match_articulo_proveedor('WRE-1214', 'Urrea', NULL);
-- SELECT * FROM fn_match_articulo_proveedor(NULL, NULL, 'TU-CODIGO-EAN');
-- SELECT count(*) FROM articulos WHERE activo = true;  -- debe retornar tus 7599 artículos
