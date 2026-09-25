-- =============================================================================
-- v127: Stock Full (fulfillment) en publicaciones_externas
-- =============================================================================
-- Agrega columnas para guardar el stock REAL del depósito Full
-- (obtenido de GET /inventories/{inventory_id}/stock/fulfillment),
-- separado de stock_publicado (available_quantity del ítem en MeLi).
--
-- stock_full: unidades VENDIBLES en el depósito Full (available_quantity
--             del endpoint de fulfillment). NULL = aún no sincronizado.
-- stock_full_updated_at: momento de la última actualización del campo.
--
-- COMO APLICARLO: copia y pega en Supabase Dashboard -> SQL Editor.
-- =============================================================================

ALTER TABLE public.publicaciones_externas
  ADD COLUMN IF NOT EXISTS stock_full            integer     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stock_full_updated_at timestamptz DEFAULT NULL;

-- Índice parcial para filtrar rápido "Full sin stock" (stock_full = 0)
CREATE INDEX IF NOT EXISTS idx_pe_stock_full
  ON public.publicaciones_externas (stock_full)
  WHERE stock_full IS NOT NULL;

-- Backfill automático: encola un sync de catálogo por cuenta MeLi activa.
-- El cron del worker (cada 1 min) lo procesa solo y puebla stock_full
-- de todas las publicaciones Full SIN necesidad de "Forzar Sync MeLi" manual.
INSERT INTO public.jobs (type, payload, status, priority, scheduled_at)
SELECT 'sync_account_catalog',
       jsonb_build_object('marketplace_id', id),
       'pending',
       5,
       now()
FROM public.marketplace_configs
WHERE is_active = true
  AND marketplace IN ('meli', 'mercadolibre');
