-- =============================================================================
-- MIGRACIÓN v72: Estabilización del Motor de Matching (Event-Driven y Fix SQL)
-- =============================================================================

BEGIN;

-- 1. LIMPIEZA INICIAL DE JOBS ATASCADOS
DELETE FROM matching_jobs WHERE estado IN ('pendiente', 'corriendo');
-- Limpiar los costos insertados sin match que fueron producto del bug
DELETE FROM costos_articulo WHERE estado_match = 'sin_match' AND vigente = false;

-- 2. FIX TÉCNICO EN fn_match_articulo_proveedor (Protección contra NULLs)
CREATE OR REPLACE FUNCTION public.fn_match_articulo_proveedor(
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
    -- Normalizar inputs, tratando NULLs como cadenas vacías para evitar que la base de datos falle
    v_norm_marca  := lower(unaccent(trim(COALESCE(p_marca, ''))));
    v_norm_modelo := lower(unaccent(trim(COALESCE(p_modelo, ''))));
    v_norm_codigo := lower(unaccent(trim(COALESCE(p_codigo, ''))));

    -- ── NIVEL 1: FUERTE (Identidad plena: Marca + Modelo + UPC cruzan al 100%) ──
    IF v_norm_codigo != '' THEN
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
          AND lower(unaccent(trim(COALESCE(a.codigo_universal, '')))) = v_norm_codigo
          AND lower(unaccent(trim(COALESCE(a.marca, '')))) = v_norm_marca
          AND lower(unaccent(trim(COALESCE(a.modelo, '')))) = v_norm_modelo
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    -- ── NIVEL 2: MEDIO (Cambio de código sugerido: Cruzan Marca + Modelo) ──
    IF v_norm_marca != '' AND v_norm_modelo != '' THEN
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
          AND lower(unaccent(trim(COALESCE(a.marca, '')))) = v_norm_marca
          AND lower(unaccent(trim(COALESCE(a.modelo, '')))) = v_norm_modelo
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    -- ── NIVEL 3: FALLBACK A FUZZY (Similitud parcial de textos) ──
    IF v_norm_marca != '' OR v_norm_modelo != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            a.codigo_universal::text,
            a.caja_madre::text,
            round((similarity(
                lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
                v_norm_marca || ' ' || v_norm_modelo
            ) * 95)::numeric, 1) AS puntaje_match,
            'fuzzy_trgm'::text AS metodo_match,
            'ambiguo'::text AS nivel_match
        FROM articulos a
        WHERE a.activo = true
          AND similarity(
              lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
              v_norm_marca || ' ' || v_norm_modelo
          ) > 0.2
        ORDER BY similarity(
            lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
            v_norm_marca || ' ' || v_norm_modelo
        ) DESC
        LIMIT 5;
    END IF;
END;
$$;


-- 3. FUNCIÓN DE COLA FIFO (Asegura Atomicidad)
CREATE OR REPLACE FUNCTION public.fn_pop_matching_job()
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_job_id uuid;
BEGIN
    SELECT id INTO v_job_id 
    FROM matching_jobs
    WHERE estado = 'pendiente'
    ORDER BY creado_el ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
        UPDATE matching_jobs 
        SET estado = 'corriendo', iniciado_el = now() 
        WHERE id = v_job_id;
    END IF;

    RETURN v_job_id;
END;
$$;

-- 4. ARQUITECTURA EVENT-DRIVEN (Trigger asíncrono vía pg_net)
CREATE OR REPLACE FUNCTION public.fn_trigger_procesar_matching()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    edge_url TEXT;
    service_key TEXT;
BEGIN
    edge_url := current_setting('app.settings.edge_url', true);
    service_key := current_setting('app.settings.service_role_key', true);

    IF edge_url IS NOT NULL AND service_key IS NOT NULL THEN
        PERFORM net.http_post(
            url := edge_url || '/functions/v1/procesar-matching',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || service_key
            ),
            body := '{}'::jsonb,
            timeout_milliseconds := 5000
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_matching_jobs_pendiente ON matching_jobs;
CREATE TRIGGER trg_matching_jobs_pendiente
AFTER INSERT OR UPDATE OF estado ON matching_jobs
FOR EACH ROW
WHEN (NEW.estado = 'pendiente')
EXECUTE FUNCTION public.fn_trigger_procesar_matching();


-- 5. REDUCIR CRON A FRECUENCIA SEGURA (Cada 30 minutos)
CREATE OR REPLACE FUNCTION public.fn_watchdog_matching()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rec RECORD;
BEGIN
    -- Busca jobs colgados por más de 10 minutos
    FOR rec IN 
        SELECT id, importacion_id FROM matching_jobs 
        WHERE estado IN ('corriendo', 'pendiente') 
          AND (
             (estado = 'corriendo' AND iniciado_el < now() - interval '10 minutes')
             OR
             (estado = 'pendiente' AND creado_el < now() - interval '10 minutes')
          )
    LOOP
        UPDATE matching_jobs SET estado = 'pendiente' WHERE id = rec.id;
        
        INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
        VALUES (rec.importacion_id, 'REINTENTO_WATCHDOG', 'Watchdog detectó timeout de 10m. Reiniciando...');
        
        -- El trigger trg_matching_jobs_pendiente se encargará de invocar la Edge Function
    END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'watchdog-matching') THEN
    PERFORM cron.unschedule('watchdog-matching');
  END IF;
  PERFORM cron.schedule('watchdog-matching', '*/30 * * * *', 'SELECT fn_watchdog_matching()');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

COMMIT;
