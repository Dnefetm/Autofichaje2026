CREATE OR REPLACE FUNCTION public.fn_preparar_importacion_revision(p_importacion_id uuid, p_proveedor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    v_resultado     jsonb;
BEGIN
    SELECT COUNT(*) INTO v_totales FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

    INSERT INTO listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
    SELECT importacion_id, proveedor, fila_num, payload, columnas_guardadas
      FROM listas_precios_raw_staging
     WHERE importacion_id = p_importacion_id;

    -- FIX: DELETE FROM listas_precios_raw_staging REMOVED para no vaciar la tabla prematuramente

    SELECT modo_carga, mapeo_columnas INTO v_modo, v_mapeo FROM importaciones_excel WHERE id = p_importacion_id;
    v_modo := COALESCE(v_modo, 'parcial');
    v_col_modelo := v_mapeo->>'columna_modelo';

    SELECT importacion_id INTO v_importacion_vieja FROM listas_precios_proveedor WHERE proveedor = p_proveedor AND vigente = true LIMIT 1;

    IF v_col_modelo IS NULL OR v_importacion_vieja IS NULL THEN
        v_nuevos := v_totales;
    ELSE
        CREATE TEMP TABLE tmp_new ON COMMIT DROP AS
        SELECT (payload->>v_col_modelo) AS modelo, md5(payload::text) as phash
        FROM listas_precios_raw WHERE importacion_id = p_importacion_id AND (payload->>v_col_modelo) IS NOT NULL;
        CREATE INDEX ON tmp_new (modelo);

        CREATE TEMP TABLE tmp_old ON COMMIT DROP AS
        SELECT (payload->>v_col_modelo) AS modelo, md5(payload::text) as phash
        FROM listas_precios_raw WHERE importacion_id = v_importacion_vieja AND (payload->>v_col_modelo) IS NOT NULL;
        CREATE INDEX ON tmp_old (modelo);

        ANALYZE tmp_new;
        ANALYZE tmp_old;

        SELECT count(*) INTO v_nuevos FROM tmp_new n WHERE NOT EXISTS (SELECT 1 FROM tmp_old o WHERE o.modelo = n.modelo);

        IF v_modo = 'full' THEN
            SELECT count(*) INTO v_eliminados FROM tmp_old o WHERE NOT EXISTS (SELECT 1 FROM tmp_new n WHERE n.modelo = o.modelo);
        ELSE
            v_eliminados := 0;
        END IF;

        SELECT count(*) INTO v_modificados FROM tmp_new n JOIN tmp_old o ON o.modelo = n.modelo WHERE n.phash <> o.phash;
    END IF;

    IF v_modo = 'full' THEN
        BEGIN
          ALTER TABLE listas_precios_proveedor DISABLE TRIGGER USER;
          UPDATE listas_precios_proveedor SET vigente = false WHERE proveedor = p_proveedor AND vigente = true;
          INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
          VALUES (p_proveedor, p_importacion_id, true, v_totales);
          ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
        EXCEPTION WHEN OTHERS THEN
          ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
          RAISE;
        END;
    END IF;

    v_resultado := public.fn_resolver_y_poblar_costos(p_importacion_id, p_proveedor);

    UPDATE importaciones_excel
       SET resumen_diff = jsonb_build_object('totales', v_totales, 'nuevos', v_nuevos, 'modificados', v_modificados, 'eliminados', v_eliminados, 'resolucion', v_resultado),
           estado = 'en_revision'::estado_importacion_excel,
           ultima_actividad = now()
     WHERE id = p_importacion_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_resolver_y_poblar_costos(p_importacion_id uuid, p_proveedor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '180s'
AS $function$
DECLARE
    v_mapeo jsonb; v_col_modelo text; v_col_codigo text; v_col_marca text; v_col_desc text; v_moneda text; v_precios jsonb;
    v_resueltos int := 0; v_pendientes int := 0; v_modelos_resueltos int := 0; v_modelos_pendientes int := 0;
BEGIN
    SELECT mapeo_columnas INTO v_mapeo FROM importaciones_excel WHERE id = p_importacion_id;
    v_col_modelo := v_mapeo->>'columna_modelo'; v_col_codigo := v_mapeo->>'columna_codigo'; v_col_marca := v_mapeo->>'columna_marca'; v_col_desc := v_mapeo->>'columna_descripcion'; v_moneda := COALESCE(v_mapeo->>'moneda_default','MXN'); v_precios := v_mapeo->'precios';
    DROP TABLE IF EXISTS tmp_filas_raw;
    CREATE TEMP TABLE tmp_filas_raw ON COMMIT DROP AS 
    SELECT payload, 
           fila_num, 
           lower(public.f_unaccent_immutable(trim(payload->>v_col_modelo))) AS modelo_norm,
           lower(public.f_unaccent_immutable(trim(payload->>v_col_codigo))) AS codigo_norm
    FROM listas_precios_raw WHERE importacion_id = p_importacion_id AND COALESCE(payload->>v_col_modelo,'') <> '';
    
    WITH alias_match_codigo AS ( 
        SELECT f.fila_num, a.articulo_id 
        FROM tmp_filas_raw f 
        JOIN proveedor_articulos_alias a 
            ON a.proveedor = p_proveedor 
            AND a.articulo_id IS NOT NULL 
            AND lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.codigo_norm 
            AND f.codigo_norm <> ''
    ), alias_match_modelo AS ( 
        SELECT f.fila_num, a.articulo_id 
        FROM tmp_filas_raw f 
        JOIN proveedor_articulos_alias a 
            ON a.proveedor = p_proveedor 
            AND a.articulo_id IS NOT NULL 
            AND lower(public.f_unaccent_immutable(trim(a.modelo_excel))) = f.modelo_norm 
    ), alias_match AS ( 
        SELECT fila_num, articulo_id FROM alias_match_codigo 
        UNION 
        SELECT fila_num, articulo_id FROM alias_match_modelo 
    ), resueltos AS ( 
        SELECT f.payload, f.fila_num, am.articulo_id 
        FROM tmp_filas_raw f 
        LEFT JOIN LATERAL ( SELECT m.articulo_id FROM alias_match m WHERE m.fila_num = f.fila_num LIMIT 1 ) am ON true 
        WHERE am.articulo_id IS NOT NULL 
    ), expand AS ( 
        SELECT r.articulo_id, r.payload, r.fila_num, p->>'columna' AS precio_col, p->>'tipo_costo' AS tipo_costo, (p->>'incluye_iva')::boolean AS incluye_iva 
        FROM resueltos r, jsonb_array_elements(v_precios) p 
    ), dedup AS ( 
        SELECT DISTINCT ON (articulo_id, tipo_costo) articulo_id, p_importacion_id AS importacion_id, payload->>v_col_modelo AS modelo_excel, payload->>v_col_marca AS marca_excel, payload->>v_col_codigo AS codigo_universal_excel, payload->>v_col_desc AS descripcion_excel, tipo_costo, NULLIF(regexp_replace(COALESCE(payload->>precio_col,'0'),'[^0-9.-]','','g'),'')::numeric AS valor, v_moneda AS moneda, 'excel' AS fuente, 'confirmado' AS estado_match, true AS vigente, incluye_iva 
        FROM expand e 
        WHERE COALESCE(e.payload->>e.precio_col,'') <> '' AND NULLIF(regexp_replace(COALESCE(e.payload->>e.precio_col,'0'),'[^0-9.-]','','g'),'')::numeric > 0 
        ORDER BY articulo_id, tipo_costo, fila_num DESC 
    ), upsert_costos AS ( 
        INSERT INTO costos_articulo ( articulo_id, importacion_id, modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, tipo_costo, valor, moneda, fuente, estado_match, vigente, incluye_iva ) 
        SELECT articulo_id, importacion_id, modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, tipo_costo, valor, moneda, fuente, estado_match, vigente, incluye_iva 
        FROM dedup 
        ON CONFLICT (articulo_id, tipo_costo, fuente) 
        DO UPDATE SET importacion_id = EXCLUDED.importacion_id, valor = EXCLUDED.valor, moneda = EXCLUDED.moneda, modelo_excel = EXCLUDED.modelo_excel, marca_excel = EXCLUDED.marca_excel, codigo_universal_excel = EXCLUDED.codigo_universal_excel, descripcion_excel = EXCLUDED.descripcion_excel, estado_match = 'confirmado', vigente = true, incluye_iva = EXCLUDED.incluye_iva, actualizado_el = now() 
        RETURNING articulo_id 
    ) SELECT count(*), count(DISTINCT articulo_id) INTO v_resueltos, v_modelos_resueltos FROM upsert_costos;
    
    WITH huerfanos AS ( 
        SELECT f.payload, f.fila_num, f.codigo_norm, f.modelo_norm
        FROM tmp_filas_raw f 
        WHERE NOT EXISTS (SELECT 1 FROM proveedor_articulos_alias a WHERE a.proveedor = p_proveedor AND a.articulo_id IS NOT NULL AND lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.codigo_norm AND f.codigo_norm <> '') 
          AND NOT EXISTS (SELECT 1 FROM proveedor_articulos_alias a WHERE a.proveedor = p_proveedor AND a.articulo_id IS NOT NULL AND lower(public.f_unaccent_immutable(trim(a.modelo_excel))) = f.modelo_norm) 
          AND NOT EXISTS (SELECT 1 FROM articulos ar WHERE lower(public.f_unaccent_immutable(trim(ar.modelo))) = f.modelo_norm) 
    ), expand AS ( 
        SELECT h.payload, h.fila_num, p->>'columna' AS precio_col, p->>'tipo_costo' AS tipo_costo 
        FROM huerfanos h, jsonb_array_elements(v_precios) p 
    ), dedup_pend AS ( 
        SELECT DISTINCT ON (COALESCE(payload->>v_col_codigo,''), COALESCE(payload->>v_col_marca,''), COALESCE(payload->>v_col_modelo,''), tipo_costo) COALESCE(payload->>v_col_codigo,'') AS codigo_excel, COALESCE(payload->>v_col_marca,'') AS marca_excel, COALESCE(payload->>v_col_modelo,'') AS modelo_excel, tipo_costo, NULLIF(regexp_replace(COALESCE(payload->>precio_col,'0'),'[^0-9.-]','','g'),'')::numeric AS valor, p_importacion_id AS importacion_id 
        FROM expand e 
        WHERE COALESCE(e.payload->>e.precio_col,'') <> '' 
        ORDER BY COALESCE(payload->>v_col_codigo,''), COALESCE(payload->>v_col_marca,''), COALESCE(payload->>v_col_modelo,''), tipo_costo, fila_num DESC 
    ), upsert_pend AS ( 
        INSERT INTO costos_pendientes (importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel, tipo_costo, moneda, valor, motivo, resuelto) 
        SELECT importacion_id, p_proveedor, codigo_excel, marca_excel, modelo_excel, tipo_costo, v_moneda, valor, 'sin_alias_ni_articulo', false 
        FROM dedup_pend 
        ON CONFLICT (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo) 
        WHERE (resuelto = false) 
        DO UPDATE SET importacion_id = EXCLUDED.importacion_id, valor = EXCLUDED.valor, moneda = EXCLUDED.moneda, motivo = EXCLUDED.motivo, actualizado_el = now() 
        RETURNING modelo_excel 
    ) SELECT count(*), count(DISTINCT modelo_excel) INTO v_pendientes, v_modelos_pendientes FROM upsert_pend;
    
    DROP TABLE IF EXISTS tmp_filas_raw;
    RETURN jsonb_build_object('costos_resueltos', v_resueltos, 'modelos_resueltos', v_modelos_resueltos, 'costos_pendientes', v_pendientes, 'modelos_pendientes', v_modelos_pendientes);
END;
$function$;
