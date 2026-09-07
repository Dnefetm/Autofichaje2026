-- =============================================================================
-- MIGRACIÓN: precios_proveedor — Mundo 1 (precios del proveedor, AUTÓNOMOS del catálogo)
-- Objetivo: procesar la lista de precios del proveedor (cambios, nuevos,
--           descontinuados, vigencia) SIN depender del matching/vinculación.
-- =============================================================================
-- Dependencias: fn_parse_precio(text) (creada en v104_fase0_importacion),
--               importaciones_excel, listas_precios_raw.
-- APPEND-ONLY: crea tabla + función nuevas. NO altera tablas existentes.
-- =============================================================================
BEGIN;

-- 1. Tabla de precios del proveedor
CREATE TABLE IF NOT EXISTS public.precios_proveedor (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor       text NOT NULL,
  importacion_id  uuid NOT NULL REFERENCES public.importaciones_excel(id) ON DELETE CASCADE,
  sku_proveedor   text NOT NULL,             -- identidad del artículo del proveedor (valor de columna_modelo)
  marca           text,
  descripcion     text,
  tipo_costo      text NOT NULL,             -- distribuidor / subdistribuidor / mayoreo / menudeo
  valor           numeric NOT NULL,
  moneda          text NOT NULL DEFAULT 'MXN',
  incluye_iva     boolean NOT NULL DEFAULT false,
  valor_anterior  numeric,                   -- valor en la lista anterior (para auditoría)
  delta_pct       numeric,                   -- variación porcentual vs lista anterior
  estado          text NOT NULL DEFAULT 'nuevo'
                  CHECK (estado IN ('nuevo','actualizado','sin_cambio','descontinuado')),
  vigente         boolean NOT NULL DEFAULT true,
  confirmado_por  text,                       -- decisión del operador en auditoría ('aprobado'/'rechazado'/NULL)
  creado_el       timestamptz NOT NULL DEFAULT now(),
  actualizado_el  timestamptz NOT NULL DEFAULT now()
);

-- Un solo estado vigente por (proveedor, sku, tipo_costo)
CREATE UNIQUE INDEX IF NOT EXISTS ux_precios_proveedor_vigente
  ON public.precios_proveedor (proveedor, sku_proveedor, tipo_costo) WHERE vigente = true;

CREATE INDEX IF NOT EXISTS idx_precios_proveedor_importacion
  ON public.precios_proveedor (importacion_id);

CREATE INDEX IF NOT EXISTS idx_precios_proveedor_proveedor_estado
  ON public.precios_proveedor (proveedor, estado);

-- 2. Función de procesamiento autónomo de precios
--    Lee la lista nueva y la anterior (por mapeo de columnas, NO nombres fijos),
--    clasifica y escribe en precios_proveedor.
CREATE OR REPLACE FUNCTION public.fn_procesar_precios_proveedor(p_importacion_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mapeo        jsonb;
  v_proveedor    text;
  v_col_modelo   text;
  v_col_marca    text;
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
  v_col_marca  := v_mapeo->>'columna_marca';
  v_col_desc   := v_mapeo->>'columna_descripcion';
  v_moneda     := COALESCE(NULLIF(v_mapeo->>'moneda_default',''), 'MXN');
  v_precios    := COALESCE(v_mapeo->'precios', '[]'::jsonb);

  IF v_col_modelo IS NULL OR v_col_modelo = '' THEN
    RAISE EXCEPTION 'columna_modelo no definida en el mapeo (id=%)', p_importacion_id;
  END IF;

  -- Importación anterior COMPLETADA del mismo proveedor (base de comparación)
  SELECT id INTO v_prev_id
  FROM importaciones_excel
  WHERE proveedor = v_proveedor
    AND estado = 'completado'
    AND id <> p_importacion_id
  ORDER BY creado_el DESC
  LIMIT 1;

  -- Idempotencia: limpiar filas previas de esta importación
  DELETE FROM public.precios_proveedor WHERE importacion_id = p_importacion_id;

  -- Apagar vigencia de las filas actuales del proveedor
  UPDATE public.precios_proveedor SET vigente = false
  WHERE proveedor = v_proveedor AND vigente = true;

  -- Insertar filas de la lista nueva, clasificando contra la anterior
  WITH nueva AS (
    SELECT DISTINCT ON (sku, tipo_costo)
      sku, marca, descripcion, tipo_costo, valor, incluye_iva
    FROM (
      SELECT
        r.fila_num,
        COALESCE(NULLIF(trim(r.payload->>v_col_modelo), ''), '') AS sku,
        COALESCE(r.payload->>v_col_marca, '') AS marca,
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

  -- Descontinuados: skus de la lista anterior ausentes en la nueva
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

  -- Conteos por SKU del lote nuevo (para UI y validación)
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

-- 3. Permisos y RLS (idempotente: DROP POLICY IF EXISTS para permitir re-ejecución)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.precios_proveedor TO authenticated, service_role;
ALTER TABLE public.precios_proveedor ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "precios_proveedor select autenticados" ON public.precios_proveedor;
CREATE POLICY "precios_proveedor select autenticados" ON public.precios_proveedor
  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "precios_proveedor write service" ON public.precios_proveedor;
CREATE POLICY "precios_proveedor write service" ON public.precios_proveedor
  FOR ALL USING (current_setting('role', true) = 'service_role');

GRANT EXECUTE ON FUNCTION public.fn_procesar_precios_proveedor(uuid) TO authenticated, service_role;

COMMIT;

-- =============================================================================
-- ROLLBACK (ejecutar SOLO si se desea revertir esta migración)
-- =============================================================================
/*
BEGIN;
DROP POLICY IF EXISTS "precios_proveedor select autenticados" ON public.precios_proveedor;
DROP POLICY IF EXISTS "precios_proveedor write service" ON public.precios_proveedor;
DROP FUNCTION IF EXISTS public.fn_procesar_precios_proveedor(uuid);
DROP TABLE IF EXISTS public.precios_proveedor;
COMMIT;
*/
