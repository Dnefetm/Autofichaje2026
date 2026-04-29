-- v101 — Tabla autónoma para precios históricos por fila (Fase 0 Real)

CREATE TABLE IF NOT EXISTS public.lista_precios_proveedor (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor     text NOT NULL,
  codigo_excel  text NOT NULL,
  marca_excel   text,
  modelo_excel  text,
  nombre_excel  text,
  precio_distrib    numeric,
  precio_subdistrib numeric,
  precio_menudeo    numeric,
  precio_mayoreo    numeric,
  articulo_id   text NULL,
  importacion_id uuid NOT NULL REFERENCES importaciones_excel(id),
  vigente       boolean DEFAULT true,
  vigente_desde timestamptz DEFAULT now(),
  vigente_hasta timestamptz,
  UNIQUE (proveedor, codigo_excel, vigente_desde)
);

CREATE INDEX IF NOT EXISTS ix_lpp_provcod ON public.lista_precios_proveedor (proveedor, codigo_excel);
CREATE INDEX IF NOT EXISTS ix_lpp_articulo ON public.lista_precios_proveedor (articulo_id) WHERE articulo_id IS NOT NULL;

-- Habilitar RLS
ALTER TABLE public.lista_precios_proveedor ENABLE ROW LEVEL SECURITY;

-- Politicas basicas
CREATE POLICY "Lectura general" ON public.lista_precios_proveedor FOR SELECT USING (true);
CREATE POLICY "All access admin" ON public.lista_precios_proveedor FOR ALL USING (true);

-- v101.b — Actualizar fn_match_precios_v2 para incluir Fase 0
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
    v_raws_count int;
    v_decisiones_count int;
BEGIN
    SELECT mapeo_columnas, proveedor, total_filas INTO v_mapeo, v_proveedor, v_total_filas
    FROM importaciones_excel 
    WHERE id = p_importacion_id;

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
    FROM listas_precios_raw
    WHERE importacion_id = p_importacion_id;

    UPDATE tmp_excel SET codigo_excel = regexp_replace(codigo_excel, '[^0-9A-Za-z]', '', 'g') WHERE codigo_excel <> '';

    -- =================================================================================
    -- FASE 0: GUARDAR PRECIOS EN LISTA HISTÓRICA AUTÓNOMA
    -- =================================================================================
    -- 1. Invalidar precios anteriores de este proveedor
    UPDATE public.lista_precios_proveedor
       SET vigente = false, vigente_hasta = now()
     WHERE proveedor = v_proveedor
       AND vigente = true;

    -- 2. Insertar todos los registros como vigentes
    WITH cte_precios AS (
       SELECT e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel,
              (SELECT NULLIF(regexp_replace(e.payload->>(p->>'columna'), '[^0-9.]', '', 'g'), '')::numeric
               FROM jsonb_array_elements(v_mapeo->'precios') p WHERE p->>'tipo_costo' = 'distribuidor' LIMIT 1) AS p_distrib,
              (SELECT NULLIF(regexp_replace(e.payload->>(p->>'columna'), '[^0-9.]', '', 'g'), '')::numeric
               FROM jsonb_array_elements(v_mapeo->'precios') p WHERE p->>'tipo_costo' = 'subdistribuidor' LIMIT 1) AS p_subdistrib,
              (SELECT NULLIF(regexp_replace(e.payload->>(p->>'columna'), '[^0-9.]', '', 'g'), '')::numeric
               FROM jsonb_array_elements(v_mapeo->'precios') p WHERE p->>'tipo_costo' = 'menudeo' LIMIT 1) AS p_menudeo,
              (SELECT NULLIF(regexp_replace(e.payload->>(p->>'columna'), '[^0-9.]', '', 'g'), '')::numeric
               FROM jsonb_array_elements(v_mapeo->'precios') p WHERE p->>'tipo_costo' = 'mayoreo' LIMIT 1) AS p_mayoreo
         FROM tmp_excel e
    )
    INSERT INTO public.lista_precios_proveedor (
       proveedor, importacion_id, codigo_excel, marca_excel, modelo_excel, nombre_excel,
       precio_distrib, precio_subdistrib, precio_menudeo, precio_mayoreo
    )
    SELECT
       v_proveedor, p_importacion_id, codigo_excel, marca_excel, modelo_excel, nombre_excel,
       p_distrib, p_subdistrib, p_menudeo, p_mayoreo
    FROM cte_precios
    ON CONFLICT DO NOTHING;

    -- =================================================================================
    -- OLA 0.A: MATCH HISTÓRICO PERFECTO (NIVEL 0)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 0, 100, true, 
        CASE WHEN alias.ultima_vez_visto > now() - interval '180 days' THEN true ELSE false END,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        CASE WHEN alias.ultima_vez_visto > now() - interval '180 days' THEN a.articulo_id ELSE NULL END, 
        v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    JOIN proveedor_articulos_alias alias 
        ON alias.proveedor = v_proveedor
       AND alias.codigo_excel = e.codigo_excel 
       AND alias.marca_excel = e.marca_excel 
       AND alias.modelo_excel = e.modelo_excel
       AND e.codigo_excel <> ''
    JOIN articulos a ON a.articulo_id = alias.articulo_id AND a.activo = true
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 0.B: ACTUALIZACIÓN DE UPC Y MATCH SIN CÓDIGO (NIVEL 0)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 0, 100, true, 
        CASE WHEN alias.ultima_vez_visto > now() - interval '180 days' THEN true ELSE false END,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        CASE WHEN alias.ultima_vez_visto > now() - interval '180 days' THEN a.articulo_id ELSE NULL END, 
        v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    JOIN proveedor_articulos_alias alias 
        ON alias.proveedor = v_proveedor
       AND alias.marca_excel = e.marca_excel 
       AND alias.modelo_excel = e.modelo_excel
       AND alias.codigo_excel = ''
    JOIN articulos a ON a.articulo_id = alias.articulo_id AND a.activo = true
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 1: MATCH EXACTO POR UPC (NIVEL 1)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 1, 100, true, false,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    JOIN articulos a ON a.codigo_universal = e.codigo_excel AND a.activo = true
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE e.codigo_excel <> '' AND md.cand_articulo_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 2: MATCH EXACTO MARCA + MODELO (NIVEL 2)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 2, 95, true, false,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    JOIN articulos a ON lower(unaccent(trim(a.marca))) = lower(unaccent(trim(e.marca_excel)))
                    AND lower(unaccent(trim(a.modelo))) = lower(unaccent(trim(e.modelo_excel)))
                    AND a.activo = true
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE e.modelo_excel <> '' AND e.marca_excel <> '' AND md.cand_articulo_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 3: MATCH EXACTO SOLO MODELO (MARCA EXCEL VACÍA) (NIVEL 3)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 3, 85, true, false,
        a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    JOIN articulos a ON lower(unaccent(trim(a.modelo))) = lower(unaccent(trim(e.modelo_excel))) AND a.activo = true
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE e.modelo_excel <> '' AND e.marca_excel = '' AND md.cand_articulo_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 4: FUZZY MATCH MARCA+MODELO (PG_TRGM) (NIVEL 4)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (fuzzy.codigo_excel, fuzzy.marca_excel, fuzzy.modelo_excel)
        p_importacion_id, 4, fuzzy.pct, true, false,
        fuzzy.cand_articulo_id, fuzzy.cand_marca, fuzzy.cand_modelo, fuzzy.cand_codigo, fuzzy.cand_nombre,
        NULL, v_proveedor, fuzzy.codigo_excel, fuzzy.marca_excel, fuzzy.modelo_excel, fuzzy.nombre_excel
    FROM (
        SELECT 
            e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel,
            a.articulo_id AS cand_articulo_id, a.marca AS cand_marca, a.modelo AS cand_modelo, a.codigo_universal AS cand_codigo, a.nombre AS cand_nombre,
            ROUND((similarity(
                lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
                lower(unaccent(trim(e.marca_excel))) || ' ' || lower(unaccent(trim(e.modelo_excel)))
            ) * 100)::numeric, 1) as pct
        FROM tmp_excel e
        LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
            AND md.codigo_universal_excel = e.codigo_excel 
            AND md.marca_excel = e.marca_excel 
            AND md.modelo_excel = e.modelo_excel
        CROSS JOIN LATERAL (
            SELECT a.articulo_id, a.marca, a.modelo, a.codigo_universal, a.nombre
            FROM articulos a
            WHERE a.activo = true
              AND md.cand_articulo_id IS NULL
              AND (e.marca_excel != '' OR e.modelo_excel != '')
              AND similarity(
                  lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
                  lower(unaccent(trim(e.marca_excel))) || ' ' || lower(unaccent(trim(e.modelo_excel)))
              ) >= 0.55
            ORDER BY similarity(
                  lower(unaccent(trim(COALESCE(a.marca, '')))) || ' ' || lower(unaccent(trim(COALESCE(a.modelo, '')))), 
                  lower(unaccent(trim(e.marca_excel))) || ' ' || lower(unaccent(trim(e.modelo_excel)))
            ) DESC
            LIMIT 1
        ) a
        WHERE md.cand_articulo_id IS NULL
    ) fuzzy
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- OLA 5: SIN MATCH (NIVEL 5)
    -- =================================================================================
    INSERT INTO matching_decisiones (
        importacion_id, nivel, pct, preseleccionado, confirmado,
        cand_articulo_id, cand_marca, cand_modelo, cand_codigo, cand_nombre,
        articulo_id_final, proveedor, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel
    )
    SELECT DISTINCT ON (e.codigo_excel, e.marca_excel, e.modelo_excel)
        p_importacion_id, 5, 0, false, false,
        NULL, NULL, NULL, NULL, NULL,
        NULL, v_proveedor, e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel
    FROM tmp_excel e
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel
    WHERE md.importacion_id IS NULL
    ON CONFLICT (importacion_id, codigo_universal_excel, marca_excel, modelo_excel) DO NOTHING;

    -- =================================================================================
    -- FASE VINCULAR: Actualizar lista_precios_proveedor con el articulo_id_final de Ola 0
    -- =================================================================================
    UPDATE public.lista_precios_proveedor l
       SET articulo_id = md.articulo_id_final
      FROM matching_decisiones md
     WHERE md.importacion_id = p_importacion_id
       AND md.importacion_id = l.importacion_id
       AND md.codigo_universal_excel = l.codigo_excel
       AND md.marca_excel = l.marca_excel
       AND md.modelo_excel = l.modelo_excel
       AND md.articulo_id_final IS NOT NULL;

    -- =================================================================================
    -- POBLAR COSTOS ARTICULO
    -- =================================================================================
    WITH precios_expandidos AS (
        SELECT 
            e.codigo_excel, e.marca_excel, e.modelo_excel, e.nombre_excel, e.moneda_excel,
            p->>'tipo_costo' AS tipo_costo,
            NULLIF(regexp_replace(e.payload->>(p->>'columna'), '[^0-9.]', '', 'g'), '')::numeric AS valor,
            COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva
        FROM tmp_excel e,
             jsonb_array_elements(v_mapeo->'precios') AS p
    )
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT 
        p_importacion_id,
        md.articulo_id_final,
        md.cand_articulo_id,
        pe.modelo_excel, pe.marca_excel, pe.codigo_excel, pe.nombre_excel, pe.nombre_excel,
        pe.tipo_costo, pe.valor, pe.moneda_excel, 'excel', 
        COALESCE(md.pct, 0), 
        CASE 
           WHEN md.nivel = 0 THEN 'completado'
           WHEN md.nivel = 1 THEN 'match_exacto'
           WHEN md.nivel IN (2, 3, 4) THEN 'match_similitud'
           ELSE 'sin_match'
        END, 
        CASE WHEN md.nivel = 0 AND md.confirmado = true THEN true ELSE false END, 
        pe.incluye_iva
    FROM precios_expandidos pe
    LEFT JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = pe.codigo_excel 
        AND md.marca_excel = pe.marca_excel 
        AND md.modelo_excel = pe.modelo_excel
    WHERE pe.valor >= 0
      AND NOT EXISTS (
          SELECT 1 FROM costos_articulo ca 
          WHERE ca.importacion_id = p_importacion_id
            AND ca.tipo_costo = pe.tipo_costo
            AND ca.modelo_excel = pe.modelo_excel
            AND ca.marca_excel = pe.marca_excel
            AND ca.valor = pe.valor
      );

    -- =================================================================================
    -- AUDITORÍA FINAL: MARCAR DESCONTINUADOS DEL PROVEEDOR
    -- =================================================================================
    UPDATE proveedor_articulos_alias
    SET estado_proveedor = 'descontinuado'
    WHERE proveedor = v_proveedor
      AND ultima_vez_visto < (now() - interval '1 day');

    -- Validación post-ejecución
    SELECT COUNT(*) INTO v_raws_count FROM tmp_excel;
    SELECT COUNT(*) INTO v_decisiones_count FROM matching_decisiones WHERE importacion_id = p_importacion_id;
    IF v_raws_count != v_decisiones_count THEN
        RAISE WARNING 'Cobertura incompleta: % raws vs % decisiones para %', v_raws_count, v_decisiones_count, p_importacion_id;
    END IF;

    -- Cerrar Job
    IF v_job_id IS NOT NULL THEN
        UPDATE matching_jobs 
        SET estado = 'completado', 
            finalizado_el = now(), 
            procesadas = v_total_filas 
        WHERE id = v_job_id;
    END IF;
    
    UPDATE importaciones_excel 
    SET estado = 'en_revision',
        ultima_actividad = now(),
        filas_procesadas = v_total_filas
    WHERE id = p_importacion_id;

    INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
    VALUES (p_importacion_id, 'MATCHING_OK', 'Evaluación de candidatos terminada con éxito.');

END $$;

