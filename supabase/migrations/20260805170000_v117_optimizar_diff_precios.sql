-- ---------------------------------------------------------------------
-- 2. fn_preparar_importacion_revision (Optimizado con Hash MD5)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_preparar_importacion_revision(
  p_importacion_id uuid,
  p_proveedor      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
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
    -- 1) Mover de staging a raw
    SELECT COUNT(*) INTO v_totales
      FROM listas_precios_raw_staging
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
        -- Optimizacion: Usamos md5(payload::text) en lugar de payload completo para el Diff
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

        -- MODIFICADOS: mismo modelo, distinto payload (comparacion de MD5 ultra rápida)
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

    -- 3) Resolver Costos y Poblarlos
    v_resultado := public.fn_resolver_y_poblar_costos(p_importacion_id, p_proveedor);

    -- Resumen diff + estado en_revision
    UPDATE importaciones_excel
       SET resumen_diff = jsonb_build_object(
             'totales', v_totales,
             'nuevos', v_nuevos,
             'modificados', v_modificados,
             'eliminados', v_eliminados,
             'resolucion', v_resultado
           ),
           estado = 'en_revision'::estado_importacion_excel,
           ultima_actividad = now()
     WHERE id = p_importacion_id;

END;
$function$;
