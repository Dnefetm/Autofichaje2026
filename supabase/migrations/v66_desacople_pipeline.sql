-- ============================================================================
-- v66 DESACOPLE DE PIPELINE (Actualización Cruda vs Matching) + Diffing
-- ============================================================================
BEGIN;

ALTER TABLE importaciones_excel
  ADD COLUMN IF NOT EXISTS resumen_diff JSONB DEFAULT '{}'::jsonb;

-- 1. Función para Preparar Revisión (Reemplaza la vieja consolidación automática prematura)
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
  -- Intentar conseguir la columna llave primaria del proveedor desde el mapeo
  SELECT mapeo_columnas INTO v_mapeo
  FROM importaciones_excel WHERE id = p_importacion_id;
  
  -- Si el Excel de ahorita se subió crudo (sin mapeo), robamos el mapeo exitoso anterior de este proveedor
  IF v_mapeo IS NULL OR v_mapeo->>'columna_modelo' IS NULL THEN
    SELECT mapeo_columnas INTO v_mapeo
    FROM importaciones_excel 
    WHERE proveedor = p_proveedor AND estado = 'completado' 
    ORDER BY creado_el DESC LIMIT 1;
  END IF;

  v_col_modelo := v_mapeo->>'columna_modelo';
  
  -- Buscar cuál es el archivo/lista "vigente" actual para comparar
  SELECT importacion_id INTO v_importacion_vieja
  FROM listas_precios_proveedor
  WHERE proveedor = p_proveedor AND vigente = true
  LIMIT 1;
  
  -- Calcular Diferenciales
  IF v_col_modelo IS NULL OR v_importacion_vieja IS NULL THEN
    -- No hay historial o el proveedor nunca ha mapeado "modelo". Toda la lista es NUEVA.
    SELECT COUNT(*) INTO v_nuevos FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;
    v_totales := v_nuevos;
  ELSE
    -- Sí hay historial. Realizar cruce JSON dinámico usando la columna "Modelo".
    -- NUEVOS: Están en el excel nuevo, no en el viejo
    SELECT COUNT(*) INTO v_nuevos 
    FROM listas_precios_raw_staging s
    WHERE s.importacion_id = p_importacion_id
      AND NOT EXISTS (
        SELECT 1 FROM listas_precios_raw o 
        WHERE o.importacion_id = v_importacion_vieja 
        AND o.payload->>v_col_modelo = s.payload->>v_col_modelo
      );
      
    -- ELIMINADOS (Descontinuados): Estaban en el viejo, no venían en este archivo nuevo
    SELECT COUNT(*) INTO v_eliminados
    FROM listas_precios_raw o
    WHERE o.importacion_id = v_importacion_vieja
      AND NOT EXISTS (
        SELECT 1 FROM listas_precios_raw_staging s 
        WHERE s.importacion_id = p_importacion_id 
        AND s.payload->>v_col_modelo = o.payload->>v_col_modelo
      );
      
    -- MODIFICADOS (Cambios de costo, etc): Existen en ambos pero el texto crudo cambió
    SELECT COUNT(*) INTO v_modificados
    FROM listas_precios_raw_staging s
    JOIN listas_precios_raw o 
      ON o.importacion_id = v_importacion_vieja 
      AND o.payload->>v_col_modelo = s.payload->>v_col_modelo
    WHERE s.payload::text != o.payload::text
      AND s.importacion_id = p_importacion_id;
    
    SELECT COUNT(*) INTO v_totales FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;
  END IF;
  
  -- Transicionar a estado EN_REVISION para que la UI le pregunte al usuario
  UPDATE importaciones_excel
  SET estado = 'en_revision'::estado_importacion_excel,
      resumen_diff = jsonb_build_object(
        'nuevos', v_nuevos,
        'eliminados', v_eliminados,
        'modificados', v_modificados,
        'total', v_totales,
        'usa_clave', v_col_modelo
      ),
      mapeo_columnas = v_mapeo,
      ultima_actividad = now(),
      heartbeat_at = now()
  WHERE id = p_importacion_id;
  
  INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
  VALUES (p_importacion_id, 'REVISION_LISTA', 'Lectura completada. Diferencias generadas. Pausado esperando confirmación manual para consolidar.');
  
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Función para Consolidar Definitivamente (cuando el usuario da OK al diff)
CREATE OR REPLACE FUNCTION fn_consolidar_revision_importacion(p_importacion_id UUID, p_proveedor TEXT)
RETURNS void AS $$
BEGIN
  -- Desactivar triggers restrictivos temporalmente
  SET LOCAL session_replication_role = 'replica';

  DELETE FROM listas_precios_raw WHERE importacion_id = p_importacion_id;
  
  -- Mover del staging al definitivo
  INSERT INTO listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
  SELECT importacion_id, proveedor, fila_num, payload, columnas_guardadas
  FROM listas_precios_raw_staging 
  WHERE importacion_id = p_importacion_id;

  -- Purgar cuarentena
  DELETE FROM listas_precios_raw_staging WHERE importacion_id = p_importacion_id;

  -- Jubilar listas anteriores del proveedor
  UPDATE listas_precios_proveedor 
  SET vigente = false 
  WHERE proveedor = p_proveedor AND vigente = true;

  -- Coronar esta como la lista Oficial
  INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
  VALUES (
     p_proveedor, p_importacion_id, true, 
     (SELECT COUNT(*) FROM listas_precios_raw WHERE importacion_id = p_importacion_id)
  );

  SET LOCAL session_replication_role = 'origin';

  -- Promover importacion y liberar el motor de matching manual secundario
  UPDATE importaciones_excel 
  SET estado = 'completado'::estado_importacion_excel, ultima_actividad = now()
  WHERE id = p_importacion_id;
  
  INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
  VALUES (p_importacion_id, 'CONSOLIDADO', 'Lista de precios actualizada en firme.');

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
