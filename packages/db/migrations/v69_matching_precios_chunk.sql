-- =============================================================================
-- MIGRACIÓN v69: Arquitectura de Matching en Chunks con LATERAL JOIN (Fase 1)
-- =============================================================================

BEGIN;

-- 1. Crear extensión pg_trgm y unaccent (por si no existen)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Asegurar el índice GIN en articulos para búsquedas súper rápidas de marca_modelo
-- La expresión indexada debe coincidir exactamente con la condición de búsqueda.
CREATE INDEX IF NOT EXISTS idx_articulos_marca_modelo_trgm
ON articulos USING gin (lower(unaccent(trim(marca || ' ' || modelo))) gin_trgm_ops);

-- 3. Asegurar índice btree para codigo_universal (búsqueda exacta)
CREATE INDEX IF NOT EXISTS idx_articulos_codigo_universal_btree
ON articulos (lower(unaccent(trim(codigo_universal))));

-- 4. RPC Procesador de Bloques (Chunk) con Idempotencia
-- Toma N filas de listas_precios_raw y las evalúa usando un LATERAL JOIN,
-- insertando los candidatos resultantes en costos_articulo u otra tabla que definamos.
-- Dado que la arquitectura original metía en costos_articulo con estado_match='sin_match',
-- adaptamos la query para imitar esa lógica de negocio, pero mucho más eficiente.

CREATE OR REPLACE FUNCTION public.fn_match_precios_chunk(
    p_importacion_id uuid,
    p_offset integer,
    p_limit integer
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    v_procesadas integer := 0;
    v_mapeo jsonb;
    v_col_modelo text;
    v_col_marca text;
    v_col_codigo text;
    v_col_desc text;
    v_col_moneda text;
    v_moneda_default text;
BEGIN
    -- Leer mapeo dinámico de la importación
    SELECT mapeo_columnas INTO v_mapeo 
    FROM importaciones_excel 
    WHERE id = p_importacion_id;
    
    IF v_mapeo IS NULL THEN
       RETURN 0;
    END IF;

    v_col_modelo := v_mapeo->>'columna_modelo';
    v_col_marca := v_mapeo->>'columna_marca';
    v_col_codigo := v_mapeo->>'columna_codigo';
    v_col_desc := v_mapeo->>'columna_descripcion';
    v_col_moneda := v_mapeo->>'columna_moneda';
    v_moneda_default := COALESCE(v_mapeo->>'moneda_default', 'MXN');

    WITH chunk AS (
        SELECT id AS staging_id, importacion_id, fila_num, payload 
        FROM listas_precios_raw 
        WHERE importacion_id = p_importacion_id
        ORDER BY fila_num
        LIMIT p_limit OFFSET p_offset
    ),
    candidatos AS (
        SELECT 
            c.staging_id,
            c.importacion_id,
            c.payload,
            COALESCE(c.payload->>v_col_modelo, '') AS val_modelo,
            COALESCE(c.payload->>v_col_marca, '') AS val_marca,
            COALESCE(c.payload->>v_col_codigo, '') AS val_codigo,
            COALESCE(c.payload->>v_col_desc, '') AS val_desc,
            COALESCE(c.payload->>v_col_moneda, v_moneda_default) AS val_moneda,
            match.articulo_id AS articulo_sugerido_id,
            match.puntaje_match,
            match.nivel_match,
            -- Calcular estado_match igual que en JS original
            CASE 
               WHEN match.nivel_match IN ('actualizado_fuerte', 'match_exacto') THEN 'match_exacto'
               WHEN match.nivel_match IN ('cambio_codigo_sugerido', 'ambiguo', 'match_similitud') THEN 'match_similitud'
               ELSE 'sin_match'
            END AS calc_estado_match
        FROM chunk c
        LEFT JOIN LATERAL (
             SELECT * FROM fn_match_articulo_proveedor(
                (c.payload->>v_col_modelo), 
                (c.payload->>v_col_marca), 
                (c.payload->>v_col_codigo)
             ) LIMIT 1
        ) match ON true
    ),
    -- Expandir los precios configurados en el mapeo (array)
    precios_expandidos AS (
        SELECT 
            c.*,
            p->>'tipo_costo' AS tipo_costo,
            NULLIF(regexp_replace(c.payload->>(p->>'columna'), '[^0-9.]', '', 'g'), '')::numeric AS valor,
            COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva
        FROM candidatos c,
             jsonb_array_elements(v_mapeo->'precios') AS p
    )
    -- Inserción final con ON CONFLICT DO NOTHING para idempotencia
    -- Asumiendo que la combinación que debe ser única en contexto de importación
    -- es (importacion_id, staging_id (o fila_num), tipo_costo) pero como staging_id 
    -- no está como FK directa, usaremos modelo_excel + marca_excel + tipo_costo + importacion_id
    -- Wait, costos_articulo tiene id autogenerado, y en su diseño no hay restricción de unicidad para la importacion cruda.
    -- Pero para la idempotencia limpia, si no hay constraint unica en costos_articulo,
    -- haremos que devuelva procesadas del chunk, ya que borrar y reinsertar es costoso.
    -- Mejor, hacemos un INSERT si no existe usando NOT EXISTS.
    
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT 
        pe.importacion_id,
        NULL, -- articulo_id (se confirma después)
        pe.articulo_sugerido_id,
        pe.val_modelo, pe.val_marca, pe.val_codigo, pe.val_desc, pe.val_desc,
        pe.tipo_costo, pe.valor, pe.val_moneda, 'excel', pe.puntaje_match, pe.calc_estado_match, false, pe.incluye_iva
    FROM precios_expandidos pe
    WHERE pe.valor > 0
      -- Check de idempotencia heurística (evitar duplicar la misma fila exacta para esta importación)
      AND NOT EXISTS (
          SELECT 1 FROM costos_articulo ca 
          WHERE ca.importacion_id = pe.importacion_id
            AND ca.tipo_costo = pe.tipo_costo
            AND ca.modelo_excel = pe.val_modelo
            AND ca.marca_excel = pe.val_marca
            AND ca.valor = pe.valor
      );
      
    GET DIAGNOSTICS v_procesadas = ROW_COUNT;
    
    RETURN v_procesadas;
END;
$$;

-- 5. Watchdog para Matching Jobs (para reanudar trabajos colgados)
CREATE OR REPLACE FUNCTION public.fn_watchdog_matching()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    rec RECORD;
    edge_url TEXT;
    service_key TEXT;
BEGIN
    edge_url := current_setting('app.settings.edge_url', true);
    service_key := current_setting('app.settings.service_role_key', true);

    -- Buscar trabajos que lleven más de 5 minutos 'corriendo' o 'pendiente' sin avanzar
    FOR rec IN 
        SELECT id FROM matching_jobs 
        WHERE estado IN ('corriendo', 'pendiente') 
          AND (
             (estado = 'corriendo' AND iniciado_el < now() - interval '5 minutes')
             OR
             (estado = 'pendiente' AND creado_el < now() - interval '5 minutes')
          )
    LOOP
        -- Revertir a pendiente
        UPDATE matching_jobs SET estado = 'pendiente' WHERE id = rec.id;
        
        -- Emitir evento de watchdog
        INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
        SELECT importacion_id, 'REINTENTO_WATCHDOG', 'Watchdog detectó timeout en Matching. Reiniciando Edge Function...'
        FROM matching_jobs WHERE id = rec.id;

        -- Despertar Edge Function (procesar-matching) de forma asíncrona usando pg_net si está habilitado
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
    END LOOP;
END;
$$;

-- Programar el watchdog de matching cada 5 minutos
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'watchdog-matching') THEN
    PERFORM cron.unschedule('watchdog-matching');
  END IF;
  PERFORM cron.schedule('watchdog-matching', '*/5 * * * *', 'SELECT fn_watchdog_matching()');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

COMMIT;
