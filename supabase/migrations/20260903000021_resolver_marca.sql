-- =============================================================================
-- MIGRACIÓN: Resolución de marca por aprobación de valores distintos
-- Modelo: tras mapear, el sistema extrae los valores distintos de la columna de
-- marca y el operador aprueba cuáles son marcas reales (marcas_validas).
-- Al procesar: si el valor está en marcas_validas -> se conserva; si no -> se
-- omite y se usa marca_default.
-- APPEND-ONLY: reemplaza fn_resolver_marca y fn_procesar_precios_proveedor.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_resolver_marca(p_mapeo jsonb, p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_col_marca      text;
  v_marca_default  text;
  v_marcas_validas jsonb;
  v_marca_raw      text;
BEGIN
  v_col_marca      := p_mapeo->>'columna_marca';
  v_marca_default  := NULLIF(trim(p_mapeo->>'marca_default'), '');
  v_marcas_validas := p_mapeo->'marcas_validas';

  IF v_col_marca IS NOT NULL AND v_col_marca <> '' THEN
    v_marca_raw := NULLIF(trim(p_payload->>v_col_marca), '');
  ELSE
    v_marca_raw := NULL;
  END IF;

  -- Sin valor crudo -> marca por defecto
  IF v_marca_raw IS NULL THEN
    RETURN v_marca_default;
  END IF;

  -- Si el valor fue aprobado como marca real -> se conserva
  IF v_marcas_validas IS NOT NULL AND jsonb_typeof(v_marcas_validas) = 'array'
     AND v_marca_raw IN (SELECT jsonb_array_elements_text(v_marcas_validas)) THEN
    RETURN v_marca_raw;
  END IF;

  -- No aprobado -> se omite y se usa la marca por defecto
  IF v_marca_default IS NOT NULL THEN
    RETURN v_marca_default;
  END IF;
  RETURN v_marca_raw;
END;
$$;

-- Reemplazar fn_procesar_precios_proveedor para usar fn_resolver_marca.
CREATE OR REPLACE FUNCTION public.fn_procesar_precios_proveedor(p_importacion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mapeo        jsonb;
  v_proveedor    text;
  v_col_modelo   text;
  v_col_desc     text;
  v_moneda       text;
  v_precios      jsonb;
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
  v_col_desc   := v_mapeo->>'columna_descripcion';
  v_moneda     := COALESCE(NULLIF(v_mapeo->>'moneda_default',''), 'MXN');
  v_precios    := COALESCE(v_mapeo->'precios', '[]'::jsonb);

  IF v_col_modelo IS NULL OR v_col_modelo = '' THEN
    RAISE EXCEPTION 'columna_modelo no definida en el mapeo (id=%)', p_importacion_id;
  END IF;

  SELECT id INTO v_prev_id
  FROM importaciones_excel
  WHERE proveedor = v_proveedor
    AND estado = 'completado'
    AND id <> p_importacion_id
  ORDER BY creado_el DESC
  LIMIT 1;

  DELETE FROM public.precios_proveedor WHERE importacion_id = p_importacion_id;

  UPDATE public.precios_proveedor SET vigente = false
  WHERE proveedor = v_proveedor AND vigente = true;

  WITH nueva AS (
    SELECT DISTINCT ON (sku, tipo_costo)
      sku, marca, descripcion, tipo_costo, valor, incluye_iva
    FROM (
      SELECT
        r.fila_num,
        COALESCE(NULLIF(trim(r.payload->>v_col_modelo), ''), '') AS sku,
        public.fn_resolver_marca(v_mapeo, r.payload) AS marca,
        COALESCE(r.payload->>v_col_desc, '') AS descripcion,
        pe->>'tipo_costo' AS tipo_costo,
        public.fn_parse_precio(r.payload->>(pe->>'columna')) AS valor,
        COALESCE((pe->>'incluye_iva')::boolean, false) AS incluye_iva
      FROM public.listas_precios_raw r
      CROSS JOIN LATERAL jsonb_array_elements(v_precios) pe
      WHERE r.importacion_id = p_importacion_id
    ) x
    ORDER BY sku, tipo_costo, (valor IS NULL), fila_num
  ),
  anterior AS (
    SELECT DISTINCT ON (sku, tipo_costo)
      sku, tipo_costo, valor
    FROM (
      SELECT
        r.fila_num,
        COALESCE(NULLIF(trim(r.payload->>v_col_modelo), ''), '') AS sku,
        pe->>'tipo_costo' AS tipo_costo,
        public.fn_parse_precio(r.payload->>(pe->>'columna')) AS valor
      FROM public.listas_precios_raw r
      CROSS JOIN LATERAL jsonb_array_elements(v_precios) pe
      WHERE r.importacion_id = v_prev_id
    ) x
    ORDER BY sku, tipo_costo, (valor IS NULL), fila_num
  ),
  comparado AS (
    SELECT
      n.sku, n.marca, n.descripcion, n.tipo_costo, n.valor, n.incluye_iva,
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
    proveedor, importacion_id, sku_proveedor, marca, descripcion,
    tipo_costo, valor, moneda, incluye_iva, valor_anterior, delta_pct, estado, vigente
  )
  SELECT
    v_proveedor, p_importacion_id, sku, marca, descripcion,
    tipo_costo, valor, v_moneda, incluye_iva,
    valor_anterior,
    CASE WHEN valor_anterior IS NOT NULL AND valor_anterior <> 0
         THEN round((valor - valor_anterior) * 100.0 / valor_anterior, 2)
         ELSE NULL END,
    estado,
    true
  FROM comparado;

  IF v_prev_id IS NOT NULL THEN
    UPDATE public.precios_proveedor
    SET estado = 'descontinuado'
    WHERE proveedor = v_proveedor
      AND importacion_id = v_prev_id
      AND sku_proveedor NOT IN (
        SELECT DISTINCT sku_proveedor FROM public.precios_proveedor WHERE importacion_id = p_importacion_id
      );

    SELECT count(DISTINCT sku_proveedor) INTO v_descontinuados
    FROM public.precios_proveedor
    WHERE proveedor = v_proveedor AND importacion_id = v_prev_id AND estado = 'descontinuado';
  END IF;

  SELECT
    count(*) FILTER (WHERE sku_estado = 'nuevo'),
    count(*) FILTER (WHERE sku_estado = 'actualizado'),
    count(*) FILTER (WHERE sku_estado = 'sin_cambio')
  INTO v_nuevos, v_actualizados, v_sin_cambio
  FROM (
    SELECT sku_proveedor,
           CASE
             WHEN bool_or(estado = 'nuevo') THEN 'nuevo'
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

GRANT EXECUTE ON FUNCTION public.fn_resolver_marca(jsonb, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_procesar_precios_proveedor(uuid) TO authenticated, service_role;

COMMIT;

-- ROLLBACK
/*
BEGIN;
DROP FUNCTION IF EXISTS public.fn_resolver_marca(jsonb, jsonb);
-- fn_procesar_precios_proveedor se restaura re-ejecutando 0020.
COMMIT;
*/
