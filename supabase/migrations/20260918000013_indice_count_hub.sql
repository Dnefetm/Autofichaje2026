-- =============================================================================
-- MIGRACIÓN (append-only): índice para el count(DISTINCT sku_proveedor) del Hub
-- =============================================================================
-- Problema: el RPC fn_hub_precios_proveedor calcula el total con
--           count(DISTINCT sku_proveedor) WHERE importacion_id = X AND vigente = true.
--           El planificador usaba un BitmapAnd de dos índices que NO cubren vigente
--           y luego un Bitmap Heap Scan de las 61k filas (10,728 bloques de heap),
--           seguido de un Sort para el DISTINCT. Medido: ~8.6s (cold cache).
--
-- Fix: un índice parcial (importacion_id, sku_proveedor) WHERE vigente=true permite
--      un Index-Only Scan con los valores ya ordenados por sku_proveedor, de modo
--      que el count(DISTINCT) se resuelve por streaming sin Sort ni acceso a heap.
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_precios_proveedor_imp_sku_vigente
  ON public.precios_proveedor (importacion_id, sku_proveedor)
  WHERE vigente = true;
