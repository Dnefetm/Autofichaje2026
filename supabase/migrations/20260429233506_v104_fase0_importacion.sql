-- SECCIÓN 1 - FASE 0: Importación de listas de precios

-- 1. Crear tabla costos_pendientes
CREATE TABLE IF NOT EXISTS public.costos_pendientes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    importacion_id uuid REFERENCES public.importaciones_excel(id) ON DELETE CASCADE,
    proveedor text NOT NULL,
    codigo_excel text,
    marca_excel text,
    modelo_excel text,
    tipo_costo text NOT NULL,
    moneda text NOT NULL,
    valor numeric NOT NULL,
    motivo text NOT NULL, -- 'sin_match', 'ambiguo'
    resuelto boolean DEFAULT false,
    creado_el timestamp with time zone DEFAULT now(),
    actualizado_el timestamp with time zone DEFAULT now()
);

-- Índice único parcial
CREATE UNIQUE INDEX IF NOT EXISTS ux_costos_pendientes_resuelto 
ON public.costos_pendientes (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo, importacion_id) 
WHERE resuelto = false;


-- 3. Función helper fn_parse_precio(text) RETURNS numeric
CREATE OR REPLACE FUNCTION public.fn_parse_precio(p_text text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_clean text;
BEGIN
    IF p_text IS NULL OR trim(p_text) = '' THEN
        RETURN NULL;
    END IF;
    -- Quitar espacios, comas y signos de dólar
    v_clean := regexp_replace(p_text, '[$\s,]', '', 'g');
    -- Manejar paréntesis para negativos ej: (10.50) -> -10.50
    IF v_clean LIKE '(%)' THEN
        v_clean := '-' || substring(v_clean from 2 for length(v_clean) - 2);
    END IF;
    RETURN v_clean::numeric;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;


-- 4. Marcado de vigencia separado
CREATE OR REPLACE FUNCTION public.fn_marcar_vigente(p_importacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_proveedor text;
BEGIN
    SELECT proveedor INTO v_proveedor FROM importaciones_excel WHERE id = p_importacion_id;
    
    -- Apagar listas anteriores del proveedor
    UPDATE public.listas_precios_proveedor
    SET vigente = false, fecha_vigor_hasta = now()
    WHERE proveedor = v_proveedor
      AND vigente = true
      AND importacion_id <> p_importacion_id;

    -- Encender la nueva lista si tiene al menos un articulo
    IF (SELECT count(*) FROM costos_articulo WHERE importacion_id = p_importacion_id) > 0 THEN
        UPDATE public.listas_precios_proveedor
        SET vigente = true
        WHERE importacion_id = p_importacion_id;
    END IF;
END;
$$;


-- 2. Reescribir fn_match_precios_v2
CREATE OR REPLACE FUNCTION public.fn_match_precios_v2(p_importacion_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_mapeo jsonb;
    v_col_modelo text;
    v_col_marca text;
    v_col_codigo text;
    v_col_nombre text;
    v_col_moneda text;
    v_moneda_default text;
    v_proveedor text;
    v_job_id uuid;
    v_total_filas int;
BEGIN
    -- Advisory lock para evitar concurrencia en la misma importación/proveedor
    -- Tomar el lock sobre el proveedor para que no haya dos importaciones del mismo proveedor en paralelo
    SELECT mapeo_columnas, proveedor, total_filas INTO v_mapeo, v_proveedor, v_total_filas
    FROM importaciones_excel 
    WHERE id = p_importacion_id;

    PERFORM pg_advisory_xact_lock(hashtext('precio_import_' || v_proveedor));

    SELECT id INTO v_job_id FROM matching_jobs WHERE importacion_id = p_importacion_id LIMIT 1;
    IF v_job_id IS NOT NULL THEN
        UPDATE matching_jobs SET estado = 'corriendo', iniciado_el = now(), total = v_total_filas WHERE id = v_job_id;
    END IF;

    v_col_modelo := v_mapeo->>'columna_modelo';
    v_col_marca := v_mapeo->>'columna_marca';
    v_col_codigo := v_mapeo->>'columna_codigo';
    v_col_nombre := v_mapeo->>'columna_descripcion';
    v_col_moneda := v_mapeo->>'columna_moneda';
    v_moneda_default := COALESCE(v_mapeo->>'moneda_default', 'MXN');

    CREATE TEMP TABLE tmp_excel ON COMMIT DROP AS
    SELECT DISTINCT
        COALESCE(payload->>v_col_codigo, '') AS codigo_excel,
        COALESCE(payload->>v_col_marca, '') AS marca_excel,
        COALESCE(payload->>v_col_modelo, '') AS modelo_excel,
        COALESCE(payload->>v_col_nombre, '') AS nombre_excel,
        COALESCE(payload->>v_col_moneda, v_moneda_default) AS moneda_excel,
        payload
    FROM listas_precios_raw_staging
    WHERE importacion_id = p_importacion_id;

    UPDATE tmp_excel SET codigo_excel = regexp_replace(codigo_excel, '[^0-9A-Za-z]', '', 'g') WHERE codigo_excel <> '';

    CREATE TEMP TABLE tmp_resolucion ON COMMIT DROP AS
    SELECT 
        e.*,
        COALESCE(
            (SELECT md.cand_articulo_id FROM matching_decisiones md WHERE md.importacion_id = p_importacion_id AND md.codigo_universal_excel = e.codigo_excel AND md.marca_excel = e.marca_excel AND md.modelo_excel = e.modelo_excel AND md.confirmado = true LIMIT 1),
            (SELECT a1.articulo_id FROM proveedor_articulos_alias a1 WHERE a1.proveedor = v_proveedor AND a1.codigo_excel = e.codigo_excel AND e.codigo_excel <> '' LIMIT 1),
            (SELECT a2.articulo_id FROM proveedor_articulos_alias a2 WHERE a2.proveedor = v_proveedor AND a2.marca_excel = e.marca_excel AND a2.modelo_excel = e.modelo_excel AND (e.codigo_excel = '' OR e.codigo_excel IS NULL) LIMIT 1),
            (SELECT a3.articulo_id FROM articulos a3 WHERE lower(unaccent(trim(a3.codigo_universal))) = lower(unaccent(trim(e.codigo_excel))) AND e.codigo_excel <> '' AND a3.activo = true LIMIT 1)
        ) AS articulo_id_resuelto
    FROM tmp_excel e;

    -- Insertar a costos_articulo sólo las filas resueltas
    WITH precios_expandidos AS (
        SELECT 
            t.codigo_excel, t.marca_excel, t.modelo_excel, t.nombre_excel, t.moneda_excel,
            t.articulo_id_resuelto,
            p->>'tipo_costo' AS tipo_costo,
            fn_parse_precio(t.payload->>(p->>'columna')) AS valor,
            COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva
        FROM tmp_resolucion t,
             jsonb_array_elements(v_mapeo->'precios') AS p
    )
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT 
        p_importacion_id,
        pe.articulo_id_resuelto,
        pe.articulo_id_resuelto,
        pe.modelo_excel, pe.marca_excel, pe.codigo_excel, pe.nombre_excel, pe.nombre_excel,
        pe.tipo_costo, pe.valor, pe.moneda_excel, 'excel', 
        100, 
        'completado', 
        true, 
        pe.incluye_iva
    FROM precios_expandidos pe
    WHERE pe.valor IS NOT NULL AND pe.articulo_id_resuelto IS NOT NULL
    ON CONFLICT (articulo_id, tipo_costo, fuente) DO UPDATE SET
        valor = EXCLUDED.valor,
        moneda = EXCLUDED.moneda,
        importacion_id = EXCLUDED.importacion_id,
        vigente = EXCLUDED.vigente,
        actualizado_el = now(),
        incluye_iva = EXCLUDED.incluye_iva;

    -- Insertar a costos_pendientes las filas NO resueltas
    WITH precios_expandidos AS (
        SELECT 
            t.codigo_excel, t.marca_excel, t.modelo_excel, t.nombre_excel, t.moneda_excel,
            p->>'tipo_costo' AS tipo_costo,
            fn_parse_precio(t.payload->>(p->>'columna')) AS valor
        FROM tmp_resolucion t,
             jsonb_array_elements(v_mapeo->'precios') AS p
        WHERE t.articulo_id_resuelto IS NULL
    )
    INSERT INTO costos_pendientes (
        importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel, tipo_costo, moneda, valor, motivo
    )
    SELECT 
        p_importacion_id, v_proveedor, pe.codigo_excel, pe.marca_excel, pe.modelo_excel, pe.tipo_costo, pe.moneda_excel, pe.valor,
        'sin_match'
    FROM precios_expandidos pe
    WHERE pe.valor IS NOT NULL
    ON CONFLICT (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo, importacion_id) 
    WHERE resuelto = false 
    DO UPDATE SET 
        valor = EXCLUDED.valor,
        actualizado_el = now();

    -- Borrar de staging
    DELETE FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

    -- Actualizar fechas de alias
    UPDATE proveedor_articulos_alias
    SET estado_proveedor = 'descontinuado'
    WHERE proveedor = v_proveedor
      AND ultima_vez_visto < (now() - interval '1 day');

    -- Marcar vigencia
    PERFORM fn_marcar_vigente(p_importacion_id);

    IF v_job_id IS NOT NULL THEN
        UPDATE matching_jobs SET estado = 'completado', progreso = v_total_filas, finalizado_el = now() WHERE id = v_job_id;
    END IF;

    UPDATE importaciones_excel SET estado = 'completado', ultima_actividad = now() WHERE id = p_importacion_id;
END;
$$;


-- 5. Trigger tg_promote_pendientes
CREATE OR REPLACE FUNCTION public.fn_tg_promote_pendientes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Mover de costos_pendientes a costos_articulo
    -- Hacemos upsert
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

    -- Marcar como resueltos
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

DROP TRIGGER IF EXISTS tg_promote_pendientes ON public.proveedor_articulos_alias;
CREATE TRIGGER tg_promote_pendientes
AFTER INSERT ON public.proveedor_articulos_alias
FOR EACH ROW EXECUTE FUNCTION public.fn_tg_promote_pendientes();


-- 6. Backfill controlado
-- Migrar filas costos_articulo con articulo_id IS NULL AND estado_match='sin_match' -> costos_pendientes
DO $$
BEGIN
    INSERT INTO costos_pendientes (importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel, tipo_costo, moneda, valor, motivo)
    SELECT 
        ca.importacion_id, 
        ie.proveedor,
        ca.codigo_universal_excel,
        ca.marca_excel,
        ca.modelo_excel,
        ca.tipo_costo,
        ca.moneda,
        ca.valor,
        'sin_match'
    FROM costos_articulo ca
    JOIN importaciones_excel ie ON ie.id = ca.importacion_id
    WHERE ca.articulo_id IS NULL AND ca.estado_match = 'sin_match'
    ON CONFLICT DO NOTHING;

    DELETE FROM costos_articulo WHERE articulo_id IS NULL AND estado_match = 'sin_match';
END $$;
