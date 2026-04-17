-- =============================================================================
-- MIGRACIÓN v62: Optimizaciones Pipeline de Precios (Batching, Multi-candidatos)
-- =============================================================================

-- ─── 1. Modificar costos_articulo para soportar múltiples candidatos ─────────
ALTER TABLE costos_articulo
  ADD COLUMN IF NOT EXISTS candidatos_jsonb JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN costos_articulo.candidatos_jsonb IS 'Lista de los top N candidatos generados por el matching inicial (array de objetos)';

-- ─── 2. Tabla de Batches de Importación ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS precio_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    importacion_excel_id UUID NOT NULL REFERENCES importaciones_excel(id) ON DELETE CASCADE,
    usuario TEXT NOT NULL,
    archivo TEXT,
    filas_afectadas INTEGER DEFAULT 0,
    estado TEXT DEFAULT 'completado',
    creado_el TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE precio_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura pública para autenticados" ON precio_import_batches FOR SELECT USING (auth.uid() IS NOT NULL);
-- Permitimos insert/delete solo a administradores o via service_role
CREATE POLICY "Admin insert/delete/update" ON precio_import_batches AS PERMISSIVE FOR ALL USING (
    (auth.jwt() ->> 'role') = 'admin' OR current_setting('role', true) = 'service_role'
);

-- ─── 3. Tabla Historico de Precios del Proveedor ────────────────────────────
CREATE TABLE IF NOT EXISTS precios_historial_proveedor (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES precio_import_batches(id) ON DELETE CASCADE,
    costo_articulo_id UUID REFERENCES costos_articulo(id) ON DELETE SET NULL,
    articulo_id TEXT NOT NULL REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    tipo_costo TEXT NOT NULL,
    valor_antiguo NUMERIC(12,2),
    valor_nuevo NUMERIC(12,2) NOT NULL,
    moneda TEXT DEFAULT 'MXN',
    creado_el TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_historial_costo UNIQUE (batch_id, costo_articulo_id)
);

ALTER TABLE precios_historial_proveedor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura pública para autenticados" ON precios_historial_proveedor FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin insert/delete/update" ON precios_historial_proveedor AS PERMISSIVE FOR ALL USING (
    (auth.jwt() ->> 'role') = 'admin' OR current_setting('role', true) = 'service_role'
);

-- ─── 4. Actualizar Función de Matching RPC ──────────────────────────────────
-- Modificamos fn_match_articulo_proveedor para retornar los TOP 5
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
    -- ── Paso 1: Match exacto por código universal ──────────────────────────
    IF p_codigo IS NOT NULL AND trim(p_codigo) != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            a.codigo_universal::text,
            100::numeric       AS puntaje_match,
            'codigo_exacto'::text AS metodo_match
        FROM articulos a
        WHERE a.activo = true
          AND lower(trim(a.modelo)) = lower(trim(p_codigo))
        LIMIT 5;

        -- Si encontró match exacto, no continúa con fuzzy
        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    -- ── Paso 2: Fuzzy con pg_trgm sobre marca + modelo ────────────────────
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
        a.codigo_universal::text,
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
    LIMIT 5;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_match_articulo_proveedor(text, text, text) TO anon, authenticated, service_role;
