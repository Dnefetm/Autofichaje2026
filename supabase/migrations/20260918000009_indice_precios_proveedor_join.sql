-- =============================================================================
-- MIGRACIÓN (append-only): índice para el JOIN de comparación en precios_proveedor
-- =============================================================================
-- Problema: fn_procesar_precios_proveedor compara la lista nueva contra la
--           anterior (anterior = precios_proveedor WHERE importacion_id = v_prev).
--           El LEFT JOIN por (sku_proveedor, tipo_costo) no tenía índice, y con
--           61k x 45k filas hacía sequential scan → statement timeout (2 min).
--
-- Fix: índice compuesto (importacion_id, sku_proveedor, tipo_costo) que sirve
--      tanto para el filtro por importacion_id como para el orden/join por
--      (sku_proveedor, tipo_costo).
--
-- Idempotente (CREATE INDEX IF NOT EXISTS). No altera datos.
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_precios_proveedor_imp_sku_tipo
  ON public.precios_proveedor (importacion_id, sku_proveedor, tipo_costo);
