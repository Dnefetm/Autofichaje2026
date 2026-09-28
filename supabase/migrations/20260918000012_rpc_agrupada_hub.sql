-- =============================================================================
-- MIGRACIÓN (append-only): RPC agrupada de precios vigentes para el Hub
-- =============================================================================
-- Problema: el Hub (/precios/[proveedor]) leía precios_proveedor fila por fila
--           (61k filas para Urrea) en ~61 consultas paginadas sin ORDER BY, y
--           agrupaba por SKU en JavaScript. Eso tomaba ~30s.
--
-- Fix: agrupar, filtrar, ordenar y paginar en SQL (una sola llamada RPC).
--   Devuelve { total, rows } donde cada fila es un SKU con:
--     - codigo_barra / fila_num / marca / descripcion (representativos del SKU)
--     - columnas (jsonb) : snapshot de columnas_a_guardar elegidas en el mapeo
--     - tiers    (jsonb) : { tipo_costo_normalizado -> valor }
--
-- El WHERE usa importacion_id directamente, aprovechando el índice
-- idx_precios_proveedor_imp_sku_tipo. De ~61 consultas → 1 llamada.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.fn_hub_precios_proveedor(
  p_importacion_id uuid,
  p_busqueda text DEFAULT NULL,
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_total bigint;
  v_rows  jsonb;
  v_busq  text := NULLIF(trim(p_busqueda), '');
BEGIN
  -- Total de SKUs (distintos) que cumplen el filtro de búsqueda.
  SELECT count(DISTINCT sku_proveedor) INTO v_total
  FROM public.precios_proveedor
  WHERE vigente = true
    AND importacion_id = p_importacion_id
    AND (
      v_busq IS NULL
      OR sku_proveedor ILIKE '%' || v_busq || '%'
      OR marca ILIKE '%' || v_busq || '%'
      OR descripcion ILIKE '%' || v_busq || '%'
    );

  -- Página de SKUs agrupados, ordenados y paginados.
  SELECT jsonb_agg(t ORDER BY t.sku_proveedor) INTO v_rows
  FROM (
    SELECT
      sku_proveedor,
      MAX(codigo_barra) AS codigo_barra,
      MAX(fila_num) AS fila_num,
      MAX(columnas::text)::jsonb AS columnas,
      MAX(marca) AS marca,
      MAX(descripcion) AS descripcion,
      jsonb_object_agg(lower(trim(tipo_costo)), valor)
        FILTER (WHERE tipo_costo IS NOT NULL AND valor IS NOT NULL) AS tiers
    FROM public.precios_proveedor
    WHERE vigente = true
      AND importacion_id = p_importacion_id
      AND (
        v_busq IS NULL
        OR sku_proveedor ILIKE '%' || v_busq || '%'
        OR marca ILIKE '%' || v_busq || '%'
        OR descripcion ILIKE '%' || v_busq || '%'
      )
    GROUP BY sku_proveedor
    ORDER BY sku_proveedor
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_hub_precios_proveedor(uuid, text, int, int)
  TO authenticated, anon, service_role;
