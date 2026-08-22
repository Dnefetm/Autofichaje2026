-- ==============================================================================
-- Migration: fix_match_precios_duplicate_key
-- Description: Evita el error ux_costos_articulo_vigente_negocio al desactivar los 
-- precios conflictivos antes de intentar insertar los nuevos como vigentes.
-- ==============================================================================
-- ==============================================================================
-- Migration: v120_fix_import_pipeline
-- Description: Desacopla fn_preparar_importacion_revision del antiguo motor y
-- alinea fn_match_precios_v2 para leer la tabla correcta.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_preparar_importacion_revision(
  p_importacion_id uuid,
  p_proveedor      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '180s'
AS $function$
DECLARE
    v_mapeo         jsonb;
    v_col_modelo    text;
    v_modo          text;
    v_importacion_vieja uuid;
    v_nuevos        int := 0;
    v_eliminados    int := 0;
    v_modificados   int := 0;
    v_totales       int := 0;
BEGIN
    -- 1) Mover de staging a raw
    SELECT COUNT(*) INTO v_totales
      FROM listas_precios_raw_staging
     WHERE importacion_id = p_importacion_id;

    -- FIX IDEMPOTENCIA: Eliminar registros previos en raw si se está reintentando el mapeo
    DELETE FROM listas_precios_raw
     WHERE importacion_id = p_importacion_id;

    INSERT INTO listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
    SELECT importacion_id, proveedor, fila_num, payload, columnas_guardadas
      FROM listas_precios_raw_staging
     WHERE importacion_id = p_importacion_id;

    DELETE FROM listas_precios_raw_staging
     WHERE importacion_id = p_importacion_id;

    -- 2) Leer el modo de carga
    SELECT modo_carga, mapeo_columnas INTO v_modo, v_mapeo
      FROM importaciones_excel
     WHERE id = p_importacion_id;

    v_modo := COALESCE(v_modo, 'parcial');
    v_col_modelo := v_mapeo->>'columna_modelo';

    -- Buscar cuál es el archivo/lista "vigente" actual para comparar
    SELECT importacion_id INTO v_importacion_vieja
      FROM listas_precios_proveedor
     WHERE proveedor = p_proveedor AND vigente = true
     LIMIT 1;

    IF v_col_modelo IS NULL OR v_importacion_vieja IS NULL THEN
        v_nuevos := v_totales;
    ELSE
        -- NUEVO (s) indexado por modelo
        CREATE TEMP TABLE tmp_new ON COMMIT DROP AS
        SELECT (payload->>v_col_modelo) AS modelo, md5(payload::text) as phash
        FROM listas_precios_raw
        WHERE importacion_id = p_importacion_id
          AND (payload->>v_col_modelo) IS NOT NULL;
        CREATE INDEX ON tmp_new (modelo);

        -- VIEJO (o) indexado por modelo
        CREATE TEMP TABLE tmp_old ON COMMIT DROP AS
        SELECT (payload->>v_col_modelo) AS modelo, md5(payload::text) as phash
        FROM listas_precios_raw
        WHERE importacion_id = v_importacion_vieja
          AND (payload->>v_col_modelo) IS NOT NULL;
        CREATE INDEX ON tmp_old (modelo);

        ANALYZE tmp_new;
        ANALYZE tmp_old;

        -- NUEVOS: en tmp_new pero no en tmp_old
        SELECT count(*) INTO v_nuevos
        FROM tmp_new n
        WHERE NOT EXISTS (SELECT 1 FROM tmp_old o WHERE o.modelo = n.modelo);

        -- ELIMINADOS: en tmp_old pero no en tmp_new
        IF v_modo = 'full' THEN
            SELECT count(*) INTO v_eliminados
            FROM tmp_old o
            WHERE NOT EXISTS (SELECT 1 FROM tmp_new n WHERE n.modelo = o.modelo);
        ELSE
            v_eliminados := 0;
        END IF;

        -- MODIFICADOS: mismo modelo, distinto payload
        SELECT count(*) INTO v_modificados
        FROM tmp_new n
        JOIN tmp_old o ON o.modelo = n.modelo
        WHERE n.phash <> o.phash;
    END IF;

    -- Full mode: marcar vieja no vigente + alta nueva
    IF v_modo = 'full' THEN
        BEGIN
          ALTER TABLE listas_precios_proveedor DISABLE TRIGGER USER;
          UPDATE listas_precios_proveedor SET vigente = false
           WHERE proveedor = p_proveedor AND vigente = true;
          INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
          VALUES (p_proveedor, p_importacion_id, true, v_totales);
          ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
        EXCEPTION WHEN OTHERS THEN
          ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
          RAISE;
        END;
    END IF;

    -- Resumen diff (SIN CAMBIAR EL ESTADO A EN_REVISION PARA PERMITIR MATCHING MASIVO)
    UPDATE importaciones_excel
       SET resumen_diff = jsonb_build_object(
             'totales', v_totales,
             'nuevos', v_nuevos,
             'modificados', v_modificados,
             'eliminados', v_eliminados
           ),
           ultima_actividad = now()
     WHERE id = p_importacion_id;

END;
$function$;

-- ==============================================================================
-- Redefinimos fn_match_precios_v2 para leer de listas_precios_raw
-- (ya que la fn anterior la movio ahi) y no borrar (ya esta borrado staging).
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.fn_match_precios_v2(p_importacion_id uuid, p_finalizar boolean DEFAULT true) 
RETURNS void 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET statement_timeout TO '180s' 
SET search_path TO 'public', 'pg_temp' 
AS $function$ 
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

    DROP TABLE IF EXISTS tmp_excel; 
    CREATE TEMP TABLE tmp_excel ON COMMIT DROP AS 
    SELECT 
        regexp_replace(COALESCE(payload->>v_col_codigo, ''), '[^0-9A-Za-z]', '', 'g') AS codigo_excel, 
        COALESCE(payload->>v_col_marca, '') AS marca_excel, 
        COALESCE(payload->>v_col_modelo, '') AS modelo_excel, 
        COALESCE(payload->>v_col_nombre, '') AS nombre_excel, 
        COALESCE(payload->>v_col_moneda, v_moneda_default) AS moneda_excel, 
        payload, 
        fila_num 
    FROM listas_precios_raw 
    WHERE importacion_id = p_importacion_id; 

    DROP TABLE IF EXISTS tmp_resolucion; 
    CREATE TEMP TABLE tmp_resolucion ON COMMIT DROP AS 
    WITH e AS (SELECT * FROM tmp_excel), 
    md_match AS ( 
        SELECT e.fila_num, md.cand_articulo_id 
        FROM e JOIN matching_decisiones md ON md.importacion_id = p_importacion_id 
        AND md.codigo_universal_excel = e.codigo_excel 
        AND md.marca_excel = e.marca_excel 
        AND md.modelo_excel = e.modelo_excel 
        AND md.confirmado = true 
    ), 
    a1_match AS ( 
        SELECT e.fila_num, a1.articulo_id 
        FROM e JOIN proveedor_articulos_alias a1 ON a1.proveedor = v_proveedor AND a1.codigo_excel = e.codigo_excel 
        WHERE e.codigo_excel <> '' 
    ), 
    a2_match AS ( 
        SELECT e.fila_num, a2.articulo_id 
        FROM e JOIN proveedor_articulos_alias a2 ON a2.proveedor = v_proveedor AND a2.marca_excel = e.marca_excel AND a2.modelo_excel = e.modelo_excel 
        WHERE e.codigo_excel = '' 
    ), 
    a3_match AS ( 
        SELECT e.fila_num, a3.articulo_id 
        FROM e JOIN articulos a3 ON lower(public.f_unaccent_immutable(trim(a3.codigo_universal))) = lower(public.f_unaccent_immutable(trim(e.codigo_excel))) 
        WHERE e.codigo_excel <> '' AND a3.activo = true 
    ) 
    SELECT e.*, COALESCE(md.cand_articulo_id, a1.articulo_id, a2.articulo_id, a3.articulo_id) AS articulo_id_resuelto 
    FROM e 
    LEFT JOIN (SELECT fila_num, MIN(cand_articulo_id) AS cand_articulo_id FROM md_match GROUP BY fila_num) md ON md.fila_num = e.fila_num 
    LEFT JOIN (SELECT fila_num, MIN(articulo_id) AS articulo_id FROM a1_match GROUP BY fila_num) a1 ON a1.fila_num = e.fila_num 
    LEFT JOIN (SELECT fila_num, MIN(articulo_id) AS articulo_id FROM a2_match GROUP BY fila_num) a2 ON a2.fila_num = e.fila_num 
    LEFT JOIN (SELECT fila_num, MIN(articulo_id) AS articulo_id FROM a3_match GROUP BY fila_num) a3 ON a3.fila_num = e.fila_num; 

    -- 1) Desactivar PREVIAMENTE los precios conflictivos para evitar el constraint ux_costos_articulo_vigente_negocio
    UPDATE costos_articulo
    SET vigente = false
    WHERE vigente = true
      AND fuente = 'excel'
      AND codigo_universal_excel IN (SELECT codigo_excel FROM tmp_resolucion WHERE codigo_excel <> '');

    WITH precios_expandidos AS ( 
        SELECT t.codigo_excel, t.marca_excel, t.modelo_excel, t.nombre_excel, t.moneda_excel, t.articulo_id_resuelto, t.fila_num, p->>'tipo_costo' AS tipo_costo, fn_parse_precio(t.payload->>(p->>'columna')) AS valor, COALESCE((p->>'incluye_iva')::boolean, false) AS incluye_iva 
        FROM tmp_resolucion t, jsonb_array_elements(v_mapeo->'precios') AS p 
    ), 
    dedup AS ( 
        SELECT DISTINCT ON (articulo_id_resuelto, tipo_costo) pe.* 
        FROM precios_expandidos pe 
        WHERE pe.valor IS NOT NULL AND pe.articulo_id_resuelto IS NOT NULL 
        ORDER BY articulo_id_resuelto, tipo_costo, fila_num DESC 
    ) 
    INSERT INTO costos_articulo ( importacion_id, articulo_id, articulo_sugerido_id, modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel, tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva ) 
    SELECT p_importacion_id, d.articulo_id_resuelto, d.articulo_id_resuelto, d.modelo_excel, d.marca_excel, d.codigo_excel, d.nombre_excel, d.nombre_excel, d.tipo_costo, d.valor, d.moneda_excel, 'excel', 100, 'match_exacto', true, d.incluye_iva 
    FROM dedup d 
    ON CONFLICT (articulo_id, tipo_costo, fuente) 
    DO UPDATE SET valor = EXCLUDED.valor, moneda = EXCLUDED.moneda, importacion_id = EXCLUDED.importacion_id, vigente = EXCLUDED.vigente, actualizado_el = now(), incluye_iva = EXCLUDED.incluye_iva; 

    WITH precios_expandidos AS ( 
        SELECT t.codigo_excel, t.marca_excel, t.modelo_excel, t.nombre_excel, t.moneda_excel, t.articulo_id_resuelto, t.fila_num, p->>'tipo_costo' AS tipo_costo, fn_parse_precio(t.payload->>(p->>'columna')) AS valor 
        FROM tmp_resolucion t, jsonb_array_elements(v_mapeo->'precios') AS p 
    ), 
    dedup_pend AS ( 
        SELECT DISTINCT ON (COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo) pe.* 
        FROM precios_expandidos pe 
        WHERE pe.valor IS NOT NULL AND pe.articulo_id_resuelto IS NULL 
        ORDER BY COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo, fila_num DESC 
    ) 
    INSERT INTO costos_pendientes ( importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel, tipo_costo, moneda, valor, motivo ) 
    SELECT p_importacion_id, v_proveedor, d.codigo_excel, d.marca_excel, d.modelo_excel, d.tipo_costo, d.moneda_excel, d.valor, 'sin_match' 
    FROM dedup_pend d 
    ON CONFLICT (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo) 
    WHERE resuelto = false 
    DO UPDATE SET valor = EXCLUDED.valor, importacion_id = EXCLUDED.importacion_id, actualizado_el = now(); 

    IF p_finalizar THEN 
        UPDATE proveedor_articulos_alias SET estado_proveedor = 'descontinuado' WHERE proveedor = v_proveedor AND ultima_vez_visto < (now() - interval '1 day'); 
        PERFORM fn_marcar_vigente(p_importacion_id); 
        
        IF v_job_id IS NOT NULL THEN 
            UPDATE matching_jobs SET estado = 'completado', progreso = v_total_filas, finalizado_el = now() WHERE id = v_job_id; 
        END IF; 
        
        UPDATE importaciones_excel SET estado = 'completado', ultima_actividad = now() WHERE id = p_importacion_id; 
    ELSE 
        UPDATE importaciones_excel SET estado = 'procesando', ultima_actividad = now() WHERE id = p_importacion_id; 
    END IF; 
END; 
$function$;

