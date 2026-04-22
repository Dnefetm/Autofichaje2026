-- ======================================================================================
-- URGENCY FIX: Re-conexión del proceso de Actualización vs Mapeo
-- ======================================================================================

-- 0. DESBLOQUEO DE IMPORTACIONES ATASCADAS (Permite subidas nuevas cancelando las fallidas)
UPDATE importaciones_excel SET estado = 'cancelado' WHERE estado IN ('pendiente_mapeo', 'mapeando', 'procesando');

-- URGENCY FIX: Re-conexión del proceso de Actualización vs Mapeo
-- ======================================================================================
-- 1. FIX DE v_col_modelo EN PREPARACIÓN DE REVISIÓN
-- (Soluciona el problema de que todos los artículos aparezcan como "Nuevos" por un error tipográfico en la llave JSON)
CREATE OR REPLACE FUNCTION fn_preparar_importacion_revision(p_importacion_id UUID, p_proveedor TEXT)
RETURNS void AS $$
DECLARE
  v_mapeo JSONB;
  v_col_modelo TEXT;
  v_nuevos INT := 0;
  v_eliminados INT := 0;
  v_modificados INT := 0;
  v_totales INT := 0;
  v_importacion_vieja UUID;
BEGIN
  SELECT mapeo_columnas INTO v_mapeo
  FROM importaciones_excel WHERE id = p_importacion_id;
  
  IF v_mapeo IS NULL OR v_mapeo->>'columna_modelo' IS NULL THEN
    SELECT mapeo_columnas INTO v_mapeo FROM importaciones_excel 
    WHERE proveedor = p_proveedor AND estado = 'completado' ORDER BY creado_el DESC LIMIT 1;
  END IF;

  v_col_modelo := v_mapeo->>'columna_modelo';
  
  SELECT importacion_id INTO v_importacion_vieja FROM listas_precios_proveedor WHERE proveedor = p_proveedor AND vigente = true LIMIT 1;
  
  IF v_col_modelo IS NULL OR v_importacion_vieja IS NULL THEN
    SELECT COUNT(*) INTO v_nuevos FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;
    v_totales := v_nuevos;
  ELSE
    SELECT COUNT(*) INTO v_nuevos FROM listas_precios_raw_staging s
    WHERE s.importacion_id = p_importacion_id AND NOT EXISTS (
        SELECT 1 FROM listas_precios_raw o WHERE o.importacion_id = v_importacion_vieja AND o.payload->>v_col_modelo = s.payload->>v_col_modelo
    );
      
    SELECT COUNT(*) INTO v_eliminados FROM listas_precios_raw o
    WHERE o.importacion_id = v_importacion_vieja AND NOT EXISTS (
        SELECT 1 FROM listas_precios_raw_staging s WHERE s.importacion_id = p_importacion_id AND s.payload->>v_col_modelo = o.payload->>v_col_modelo
    );
      
    SELECT COUNT(*) INTO v_modificados FROM listas_precios_raw_staging s
    JOIN listas_precios_raw o ON o.importacion_id = v_importacion_vieja AND o.payload->>v_col_modelo = s.payload->>v_col_modelo
    WHERE s.payload::text != o.payload::text AND s.importacion_id = p_importacion_id;
    
    SELECT COUNT(*) INTO v_totales FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;
  END IF;
  
  UPDATE importaciones_excel SET estado = 'en_revision'::estado_importacion_excel, 
    resumen_diff = jsonb_build_object('nuevos', v_nuevos, 'eliminados', v_eliminados, 'modificados', v_modificados, 'totales', v_totales)
  WHERE id = p_importacion_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. FIX DE EXTRACCIÓN AUTOMÁTICA DE PRECIOS EN CONSOLIDACIÓN
-- (Soluciona el problema de que los precios de artículos conocidos NO se actualizaban al aprobar la tabla cruda)
CREATE OR REPLACE FUNCTION fn_consolidar_revision_importacion(p_importacion_id UUID, p_proveedor TEXT)
RETURNS void AS $$
DECLARE
  v_mapeo JSONB;
  v_col_modelo TEXT;
  v_precios JSONB;
  v_precio JSONB;
BEGIN
  SET LOCAL session_replication_role = 'replica';

  DELETE FROM listas_precios_raw WHERE importacion_id = p_importacion_id;
  
  INSERT INTO listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
  SELECT importacion_id, proveedor, fila_num, payload, columnas_guardadas FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

  DELETE FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

  UPDATE listas_precios_proveedor SET vigente = false WHERE proveedor = p_proveedor AND vigente = true;

  INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
  VALUES (p_proveedor, p_importacion_id, true, (SELECT COUNT(*) FROM listas_precios_raw WHERE importacion_id = p_importacion_id));

  -- LÓGICA DE EXTRACCIÓN Y ACTUALIZACIÓN 100% CIEGA Y DESACOPLADA
  SELECT mapeo_columnas INTO v_mapeo FROM importaciones_excel WHERE id = p_importacion_id;
  IF v_mapeo IS NULL OR v_mapeo->>'columna_modelo' IS NULL THEN
    SELECT mapeo_columnas INTO v_mapeo FROM importaciones_excel WHERE proveedor = p_proveedor AND estado = 'completado' ORDER BY creado_el DESC LIMIT 1;
  END IF;
  
  v_col_modelo := v_mapeo->>'columna_modelo';
  v_precios := v_mapeo->'precios';

  IF v_col_modelo IS NOT NULL AND jsonb_typeof(v_precios) = 'array' THEN
     -- Retirar del catálogo los precios provistos previamente por excel de este proveedor
     UPDATE costos_articulo c SET vigente = false FROM importaciones_excel i WHERE c.importacion_id = i.id AND i.proveedor = p_proveedor AND c.fuente = 'excel' AND c.vigente = true;
       
     FOR v_precio IN SELECT * FROM jsonb_array_elements(v_precios)
     LOOP
        INSERT INTO costos_articulo (
            importacion_id, articulo_id, articulo_sugerido_id, modelo_excel, marca_excel, 
            codigo_universal_excel, descripcion_excel, nombre_excel, tipo_costo, valor, moneda, 
            fuente, estado_match, vigente, incluye_iva
        )
        SELECT 
            p_importacion_id,
            hist.articulo_id,
            hist.articulo_sugerido_id,
            r.payload->>v_col_modelo, 
            r.payload->>(v_mapeo->>'columna_marca'),
            r.payload->>(v_mapeo->>'columna_codigo'),
            r.payload->>(v_mapeo->>'columna_descripcion'),
            r.payload->>(v_mapeo->>'columna_descripcion'),
            v_precio->>'tipo_costo',
            CAST(NULLIF(regexp_replace(r.payload->>(v_precio->>'columna'), '[^0-9.]', '', 'g'), '') AS numeric),
            COALESCE(r.payload->>(v_mapeo->>'columna_moneda'), v_mapeo->>'moneda_default', 'MXN'),
            'excel',
            COALESCE(hist.estado_match, 'sin_match'),
            true, 
            COALESCE((v_precio->>'incluye_iva')::boolean, false)
        FROM listas_precios_raw r
        LEFT JOIN (
            -- Extraemos SOLO la data histórico de matching para preservar la conexión catálogo maestro
            SELECT DISTINCT c_old.modelo_excel, c_old.articulo_id, c_old.articulo_sugerido_id, c_old.estado_match
            FROM costos_articulo c_old
            JOIN importaciones_excel i_old ON c_old.importacion_id = i_old.id
            WHERE i_old.proveedor = p_proveedor 
              AND c_old.estado_match IN ('match_exacto', 'confirmado')
              AND c_old.modelo_excel IS NOT NULL
        ) hist ON hist.modelo_excel = (r.payload->>v_col_modelo)
        WHERE r.importacion_id = p_importacion_id
          AND r.payload->>(v_precio->>'columna') IS NOT NULL
          AND NULLIF(regexp_replace(r.payload->>(v_precio->>'columna'), '[^0-9.]', '', 'g'), '') != '';
     END LOOP;
  END IF;

  SET LOCAL session_replication_role = 'origin';

  UPDATE importaciones_excel SET estado = 'completado'::estado_importacion_excel, ultima_actividad = now() WHERE id = p_importacion_id;
  INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje) VALUES (p_importacion_id, 'CONSOLIDADO', 'Lista de precios actualizada y transferida a catálogo.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
