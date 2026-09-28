CREATE OR REPLACE FUNCTION public.fn_procesar_precios_proveedor(p_importacion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mapeo        jsonb;
  v_proveedor    text;
  v_col_modelo   text;
  v_col_codigo   text;
  v_col_marca    text;
  v_col_desc     text;
  v_moneda       text;
  v_precios      jsonb;
  v_columnas_guardar jsonb;
  v_prev_id      uuid;
  v_nuevos       int := 0;
  v_actualizados int := 0;
  v_sin_cambio   int := 0;
  v_descontinuados int := 0;
BEGIN
  SELECT mapeo_columnas, proveedor INTO v_mapeo, v_proveedor
  FROM importaciones_excel WHERE id = p_importacion_id;

  IF v_mapeo IS NULL OR v_proveedor IS NULL THEN
    RAISE EXCEPTION 'Importación sin mapeo o proveedor (id=%)', p_importacion_id;
  END IF;

  v_col_modelo := v_mapeo->>'columna_modelo';
  v_col_codigo := v_mapeo->>'columna_codigo';
  v_col_marca  := v_mapeo->>'columna_marca';
  v_col_desc   := v_mapeo->>'columna_descripcion';
  v_moneda     := COALESCE(NULLIF(v_mapeo->>'moneda_default',''), 'MXN');
  v_precios    := COALESCE(v_mapeo->'precios', '[]'::jsonb);
  v_columnas_guardar := COALESCE(v_mapeo->'columnas_a_guardar', '[]'::jsonb);

  IF v_col_modelo IS NULL OR v_col_modelo = '' THEN
    RAISE EXCEPTION 'columna_modelo no definida en el mapeo (id=%)', p_importacion_id;
  END IF;

  -- Lista VIGENTE actual del proveedor (base de comparación real)
  SELECT importacion_id INTO v_prev_id
  FROM public.listas_precios_proveedor
  WHERE proveedor = v_proveedor
    AND vigente = true
    AND importacion_id <> p_importacion_id
  LIMIT 1;

  -- Idempotencia: limpiar filas previas de esta importación
  DELETE FROM public.precios_proveedor WHERE importacion_id = p_importacion_id;

  -- Apagar vigencia de las filas actuales del proveedor
  UPDATE public.precios_proveedor SET vigente = false
  WHERE proveedor = v_proveedor AND vigente = true;

  -- Insertar filas de la lista nueva, clasificando contra la anterior
  WITH raw_eval AS (
      SELECT
        r.fila_num,
        COALESCE(NULLIF(trim(r.payload->>v_col_modelo), ''), '') AS sku,
        COALESCE(NULLIF(trim(r.payload->>v_col_codigo), ''), '') AS codigo_barra,
        COALESCE(r.payload->>v_col_marca, '') AS marca,
        COALESCE(r.payload->>v_col_desc, '') AS descripcion,
        (
          SELECT jsonb_object_agg(col, r.payload->>col)
          FROM jsonb_array_elements_text(v_columnas_guardar) AS col
          WHERE r.payload ? col
        ) AS columnas,
        r.payload
      FROM public.listas_precios_raw r
      WHERE r.importacion_id = p_importacion_id
  ),
  nueva AS (
    SELECT DISTINCT ON (sku, tipo_costo)
      sku, codigo_barra, fila_num, columnas, marca, descripcion, tipo_costo, valor, incluye_iva
    FROM (
      SELECT
        r.fila_num,
        r.sku,
        r.codigo_barra,
        r.marca,
        r.descripcion,
        r.columnas,
        pe->>'tipo_costo' AS tipo_costo,
        public.fn_parse_precio(r.payload->>(pe->>'columna')) AS valor,
        COALESCE((pe->>'incluye_iva')::boolean, false) AS incluye_iva
      FROM raw_eval r
      CROSS JOIN LATERAL jsonb_array_elements(v_precios) pe
    ) x
    ORDER BY sku, tipo_costo, (valor IS NULL), fila_num
  ),
  anterior AS (
    SELECT DISTINCT ON (sku_proveedor, tipo_costo)
      sku_proveedor AS sku, tipo_costo, valor
    FROM public.precios_proveedor
    WHERE importacion_id = v_prev_id
    ORDER BY sku_proveedor, tipo_costo
  ),
  comparado AS (
    SELECT
      n.sku, n.codigo_barra, n.fila_num, n.columnas, n.marca, n.descripcion, n.tipo_costo, n.valor, n.incluye_iva,
      a.valor AS valor_anterior,
      CASE
        WHEN a.valor IS NULL THEN 'nuevo'
        WHEN a.valor IS DISTINCT FROM n.valor THEN 'actualizado'
        ELSE 'sin_cambio'
      END AS estado
    FROM nueva n
    LEFT JOIN anterior a ON a.sku = n.sku AND a.tipo_costo = n.tipo_costo
    WHERE n.sku <> '' AND n.valor IS NOT NULL
  )
  INSERT INTO public.precios_proveedor (
    proveedor, importacion_id, sku_proveedor, codigo_barra, fila_num, columnas, marca, descripcion,
    tipo_costo, valor, moneda, incluye_iva, valor_anterior, delta_pct, estado, vigente
  )
  SELECT
    v_proveedor, p_importacion_id, sku, codigo_barra, fila_num, columnas, marca, descripcion,
    tipo_costo, valor, v_moneda, incluye_iva,
    valor_anterior,
    CASE WHEN valor_anterior IS NOT NULL AND valor_anterior <> 0
         THEN round((valor - valor_anterior) * 100.0 / valor_anterior, 2)
         ELSE NULL END,
    estado,
    true
  FROM comparado;

  -- Descontinuados: skus de la lista vigente anterior ausentes en la nueva
  IF v_prev_id IS NOT NULL THEN
    UPDATE public.precios_proveedor p
    SET estado = 'descontinuado'
    WHERE p.proveedor = v_proveedor
      AND p.importacion_id = v_prev_id
      AND NOT EXISTS (
        SELECT 1 FROM public.precios_proveedor p2 
        WHERE p2.importacion_id = p_importacion_id AND p2.sku_proveedor = p.sku_proveedor
      );

    SELECT count(DISTINCT sku_proveedor) INTO v_descontinuados
    FROM public.precios_proveedor
    WHERE proveedor = v_proveedor AND importacion_id = v_prev_id AND estado = 'descontinuado';
  END IF;

  -- Conteos por SKU del lote nuevo (para UI y validación)
  SELECT
    count(*) FILTER (WHERE sku_estado = 'nuevo'),
    count(*) FILTER (WHERE sku_estado = 'actualizado'),
    count(*) FILTER (WHERE sku_estado = 'sin_cambio')
  INTO v_nuevos, v_actualizados, v_sin_cambio
  FROM (
    SELECT sku_proveedor,
           CASE
             WHEN bool_and(estado = 'nuevo') THEN 'nuevo'
             WHEN bool_or(estado = 'actualizado') THEN 'actualizado'
             ELSE 'sin_cambio'
           END AS sku_estado
    FROM public.precios_proveedor
    WHERE importacion_id = p_importacion_id AND vigente = true
    GROUP BY sku_proveedor
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'nuevos', v_nuevos,
    'actualizados', v_actualizados,
    'sin_cambio', v_sin_cambio,
    'descontinuados', v_descontinuados
  );
END;
$$;
