-- =============================================================================
-- V110: FIX CARGAS PARCIALES Y ROLLBACK DE EMERGENCIA
-- =============================================================================

-- 1. ROLLBACK DE EMERGENCIA (Paso 0)
-- Borrar la consolidación parcial dañada que cerró la vigencia de todo el catálogo.
DO $$ 
DECLARE
    v_prov text;
BEGIN
    SELECT proveedor INTO v_prov FROM importaciones_excel WHERE id = 'ea62b745-1759-47ba-86a6-024f8e114fbd';
    
    IF v_prov IS NOT NULL THEN
        -- Borramos la entrada en listas_precios_proveedor que apagó la vigencia global
        DELETE FROM listas_precios_proveedor WHERE importacion_id = 'ea62b745-1759-47ba-86a6-024f8e114fbd';
        
        -- Restauramos la vigencia de la última lista válida de ese proveedor
        UPDATE listas_precios_proveedor
        SET vigente = true
        WHERE id = (
            SELECT id FROM listas_precios_proveedor 
            WHERE proveedor = v_prov 
            ORDER BY creado_el DESC LIMIT 1
        );
          
        -- Marcamos la importación rota como error
        UPDATE importaciones_excel 
        SET estado = 'error', error_mensaje = 'Cancelada por Rollback de Emergencia (Bug Carga Parcial)'
        WHERE id = 'ea62b745-1759-47ba-86a6-024f8e114fbd';
        
        INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje) 
        VALUES ('ea62b745-1759-47ba-86a6-024f8e114fbd', 'ERROR_FATAL', 'Rollback de emergencia por bug de carga parcial');
    END IF;
END $$;


-- 2. ALTER TABLE
ALTER TABLE importaciones_excel
ADD COLUMN IF NOT EXISTS modo_carga TEXT DEFAULT 'parcial' CHECK (modo_carga IN ('full', 'parcial', 'merge'));


-- 3. REESCRITURA DE fn_preparar_importacion_revision
CREATE OR REPLACE FUNCTION public.fn_preparar_importacion_revision(
  p_importacion_id uuid,
  p_proveedor      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_mapeo               jsonb;
  v_col_modelo          text;
  v_nuevos              int := 0;
  v_eliminados          int := 0;
  v_modificados         int := 0;
  v_totales             int := 0;
  v_importacion_vieja   uuid;
  v_resultado           jsonb;
  v_modelos_resueltos   int := 0;
  v_modelos_pendientes  int := 0;
  v_modo                text;
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
      -- No hay historial o el proveedor nunca ha mapeado "modelo". Toda la lista es NUEVA.
      v_nuevos := v_totales;
  ELSE
      -- Calcular Diferenciales
      SELECT COUNT(*) INTO v_nuevos 
      FROM listas_precios_raw s
      WHERE s.importacion_id = p_importacion_id
        AND NOT EXISTS (
          SELECT 1 FROM listas_precios_raw o 
          WHERE o.importacion_id = v_importacion_vieja 
          AND o.payload->>v_col_modelo = s.payload->>v_col_modelo
        );
        
      IF v_modo = 'full' THEN
          -- ELIMINADOS (Descontinuados): Estaban en el viejo, no venían en este archivo nuevo
          SELECT COUNT(*) INTO v_eliminados
          FROM listas_precios_raw o
          WHERE o.importacion_id = v_importacion_vieja
            AND NOT EXISTS (
              SELECT 1 FROM listas_precios_raw s 
              WHERE s.importacion_id = p_importacion_id 
              AND s.payload->>v_col_modelo = o.payload->>v_col_modelo
            );
      ELSE
          -- Si es parcial/merge, NUNCA hay descontinuados explícitamente
          v_eliminados := 0;
      END IF;
        
      -- MODIFICADOS
      SELECT COUNT(*) INTO v_modificados
      FROM listas_precios_raw s
      JOIN listas_precios_raw o 
        ON o.importacion_id = v_importacion_vieja 
        AND o.payload->>v_col_modelo = s.payload->>v_col_modelo
      WHERE s.payload::text != o.payload::text
        AND s.importacion_id = p_importacion_id;
  END IF;

  -- CRITICO: En modo Full, creamos un registro de listas_precios_proveedor preparatorio.
  -- En modo Parcial, lo omitimos para no perturbar la vista productiva actual durante revisión.
  IF v_modo = 'full' THEN
      BEGIN
        ALTER TABLE listas_precios_proveedor DISABLE TRIGGER USER;
        UPDATE listas_precios_proveedor
           SET vigente = false
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
  v_resultado          := public.fn_resolver_y_poblar_costos(p_importacion_id, p_proveedor);
  v_modelos_resueltos  := COALESCE((v_resultado->>'modelos_resueltos')::int, 0);
  v_modelos_pendientes := COALESCE((v_resultado->>'modelos_pendientes')::int, 0);

  UPDATE importaciones_excel
     SET resumen_diff = jsonb_build_object(
           'totales',              v_totales,
           'nuevos',               v_nuevos,
           'modificados',          v_modificados,
           'eliminados',           v_eliminados,
           'modelos_resueltos',    v_modelos_resueltos,
           'modelos_pendientes',   v_modelos_pendientes,
           'costos_actualizados',  COALESCE((v_resultado->>'costos_resueltos')::int, 0),
           'costos_pendientes',    COALESCE((v_resultado->>'costos_pendientes')::int, 0)
         ),
         estado            = 'en_revision'::estado_importacion_excel,
         ultima_actividad  = now()
   WHERE id = p_importacion_id;

  INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
  VALUES (
    p_importacion_id, 'REVISION_LISTA',
    format('Preparada en modo %s. Resueltos %s modelos / Pendientes %s modelos', v_modo, v_modelos_resueltos, v_modelos_pendientes)
  );
END;
$function$;


-- 4. REESCRITURA DE fn_consolidar_revision_importacion
CREATE OR REPLACE FUNCTION public.fn_consolidar_revision_importacion(p_importacion_id uuid, p_proveedor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_insertados INT;
  v_actualizados INT;
  v_modo TEXT;
BEGIN
  SELECT modo_carga INTO v_modo FROM importaciones_excel WHERE id = p_importacion_id;
  v_modo := COALESCE(v_modo, 'parcial');

  -- 1) UPSERT en precios_proveedor_actual
  WITH upsert AS (
    INSERT INTO precios_proveedor_actual (
      proveedor, codigo, codigo_barra, marca, descripcion,
      precio_lista, precio_distribuidor, precio_dist_iva,
      precio_menudeo, precio_mayoreo, precio_subdist, pvl, pp,
      importacion_origen, fila_raw_origen, actualizado_el
    )
    SELECT
      p_proveedor,
      lpr.payload->>'CÓDIGO',
      lpr.payload->>'CÓDIGO DE BARRA',
      lpr.payload->>'MARCA',
      lpr.payload->>'DESCRIPCIÓN LARGA',
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO DE LISTA', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'P.DIST', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'P.DIST (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO MENUDEO (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO MAYORE (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO SUBDISTRIBUIDOR (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PVL', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PP', '[^0-9.-]', '', 'g'), '')::numeric,
      p_importacion_id, lpr.id, now()
    FROM listas_precios_raw lpr
    WHERE lpr.importacion_id = p_importacion_id
      AND lpr.payload <> '{}'::jsonb
      AND lpr.payload->>'CÓDIGO' IS NOT NULL
      AND lpr.payload->>'CÓDIGO' != 'CÓDIGO'
      AND lpr.revertido_at IS NULL
    ON CONFLICT (proveedor, codigo) DO UPDATE SET
      codigo_barra       = EXCLUDED.codigo_barra,
      marca              = EXCLUDED.marca,
      descripcion        = EXCLUDED.descripcion,
      precio_lista       = EXCLUDED.precio_lista,
      precio_distribuidor= EXCLUDED.precio_distribuidor,
      precio_dist_iva    = EXCLUDED.precio_dist_iva,
      precio_menudeo     = EXCLUDED.precio_menudeo,
      precio_mayoreo     = EXCLUDED.precio_mayoreo,
      precio_subdist     = EXCLUDED.precio_subdist,
      pvl                = EXCLUDED.pvl,
      pp                 = EXCLUDED.pp,
      importacion_origen = EXCLUDED.importacion_origen,
      fila_raw_origen    = EXCLUDED.fila_raw_origen,
      actualizado_el     = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT
    count(*) FILTER (WHERE inserted) AS insertados,
    count(*) FILTER (WHERE NOT inserted) AS actualizados
  INTO v_insertados, v_actualizados FROM upsert;

  -- 2) Auditoría y Vigencia (Diferenciada por modo_carga)
  IF v_modo = 'full' THEN
      UPDATE listas_precios_proveedor
         SET vigente = false
       WHERE proveedor = p_proveedor
         AND vigente = true
         AND importacion_id IS DISTINCT FROM p_importacion_id;
  END IF;

  INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
  VALUES (p_proveedor, p_importacion_id, true, v_insertados + v_actualizados)
  ON CONFLICT DO NOTHING;

  -- 3) MERGE-SAFE en costos_articulo
  ALTER TABLE costos_articulo DISABLE TRIGGER USER;
  IF v_modo = 'full' THEN
      UPDATE costos_articulo ca
         SET vigente = false
       WHERE ca.vigente = true
         AND ca.importacion_id IS DISTINCT FROM p_importacion_id
         AND ca.articulo_id IN (
           SELECT DISTINCT articulo_id
             FROM costos_articulo
            WHERE importacion_id = p_importacion_id
              AND articulo_id IS NOT NULL
         );
  END IF;

  UPDATE costos_articulo
     SET vigente = true
   WHERE importacion_id = p_importacion_id
     AND articulo_id IS NOT NULL;
  ALTER TABLE costos_articulo ENABLE TRIGGER USER;

  UPDATE importaciones_excel SET estado='completado'::estado_importacion_excel, ultima_actividad=now()
   WHERE id = p_importacion_id;

  INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
  VALUES (p_importacion_id, 'CONSOLIDADO', format('Revision finalizada en modo %s. Cambios proyectados al catalogo.', v_modo));

  RETURN jsonb_build_object('insertados', v_insertados, 'actualizados', v_actualizados);
EXCEPTION WHEN OTHERS THEN
  ALTER TABLE costos_articulo ENABLE TRIGGER USER;
  RAISE;
END;
$function$;
