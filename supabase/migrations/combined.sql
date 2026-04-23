ALTER TYPE estado_importacion_excel ADD VALUE IF NOT EXISTS 'en_revision' BEFORE 'completado';

-- 1. Desactivar el watchdog de forma segura
UPDATE cron.job SET active = false WHERE jobname ILIKE '%watchdog%';

-- 2. Modificar la funcion del trigger para apuntar a procesar-matching
CREATE OR REPLACE FUNCTION fn_disparar_edge_procesar_importacion()
RETURNS TRIGGER AS $$
DECLARE
  edge_url TEXT;
  service_key TEXT;
  req_body JSONB;
BEGIN
  -- Parametros inyectados por ALTER DATABASE SET ...
  edge_url := current_setting('app.settings.edge_url', true);
  service_key := current_setting('app.settings.service_role_key', true);
  
  IF edge_url IS NOT NULL AND service_key IS NOT NULL THEN
     req_body := json_build_object('importacion_id', NEW.id);
     
     PERFORM net.http_post(
         url := edge_url || '/functions/v1/procesar-matching',
         headers := jsonb_build_object(
             'Content-Type', 'application/json',
             'Authorization', 'Bearer ' || service_key
         ),
         body := req_body,
         timeout_milliseconds := 10000
     );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- MIGRACIÓN v71: Restauración del motor de matching (Fix PR-A)
-- Restaura la firma correcta de fn_match_articulo_proveedor con nivel_match
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

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
    caja_madre       text,
    puntaje_match    numeric,
    metodo_match     text,      
    nivel_match      text       
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_norm_marca text;
    v_norm_modelo text;
    v_norm_codigo text;
BEGIN
    -- Normalizar inputs
    v_norm_marca  := lower(unaccent(trim(p_marca)));
    v_norm_modelo := lower(unaccent(trim(p_modelo)));
    v_norm_codigo := lower(unaccent(trim(p_codigo)));

    -- ── NIVEL 1: FUERTE (Identidad plena si todos los campos cruzan) ──
    IF v_norm_codigo IS NOT NULL AND v_norm_codigo != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            a.codigo_universal::text,
            a.caja_madre::text,
            100::numeric AS puntaje_match,
            'codigo_exacto'::text AS metodo_match,
            'actualizado_fuerte'::text AS nivel_match
        FROM articulos a
        WHERE a.activo = true
          AND lower(unaccent(trim(a.codigo_universal))) = v_norm_codigo
          AND lower(unaccent(trim(a.marca))) = v_norm_marca
          AND lower(unaccent(trim(a.modelo))) = v_norm_modelo
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    -- ── NIVEL 2: MEDIO (Cambio de código sugerido - Cruzan marca y modelo, no el código) ──
    IF v_norm_marca IS NOT NULL AND v_norm_marca != '' AND v_norm_modelo IS NOT NULL AND v_norm_modelo != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            a.codigo_universal::text,
            a.caja_madre::text,
            85::numeric AS puntaje_match,
            'marca_modelo_exacto'::text AS metodo_match,
            'cambio_codigo_sugerido'::text AS nivel_match
        FROM articulos a
        WHERE a.activo = true
          AND lower(unaccent(trim(a.marca))) = v_norm_marca
          AND lower(unaccent(trim(a.modelo))) = v_norm_modelo
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    -- ── NIVEL 3: FALLBACK A FUZZY ──
    IF v_norm_marca IS NOT NULL OR v_norm_modelo IS NOT NULL THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            a.codigo_universal::text,
            a.caja_madre::text,
            round((similarity(lower(a.marca || ' ' || a.modelo), lower(p_marca || ' ' || p_modelo)) * 95)::numeric, 1) AS puntaje_match,
            'fuzzy_trgm'::text AS metodo_match,
            'ambiguo'::text AS nivel_match
        FROM articulos a
        WHERE a.activo = true
          AND similarity(lower(a.marca || ' ' || a.modelo), lower(p_marca || ' ' || p_modelo)) > 0.2
        ORDER BY similarity(lower(a.marca || ' ' || a.modelo), lower(p_marca || ' ' || p_modelo)) DESC
        LIMIT 5;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_match_articulo_proveedor(text, text, text) TO anon, authenticated, service_role;

-- 4. Asegurar que los ENUMs de estado_match soportan los nuevos niveles
ALTER TABLE costos_articulo DROP CONSTRAINT IF EXISTS chk_costos_articulo_estado_match;
ALTER TABLE costos_articulo ADD CONSTRAINT chk_costos_articulo_estado_match 
  CHECK (estado_match IN (
    'sin_match', 'sugerido', 'confirmado', 'rechazado',
    'actualizado_fuerte', 'cambio_codigo_sugerido', 'ambiguo', 'nuevo',
    'descontinuado_por_proveedor',
    'match_exacto', 'match_similitud'
  ));

COMMIT;

UPDATE importaciones_excel SET estado='pendiente_mapeo' WHERE id='56a261b9-1ebb-4944-8ff2-956f82276ab9';