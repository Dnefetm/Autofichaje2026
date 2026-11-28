-- Migration: 20261127232500_blindaje_concurrencia_worker.sql
-- Description: Blindaje anti-rafagas (Pieza 1 y semilla Pieza 3):
--   1) Topico 'items' pasa a ventana de 30s sin dispatch inmediato (orders_v2, payments y questions siguen inmediatos).
--   2) Semilla de fila 'worker_active_lease' en webhook_config para concurrencia singleton (TTL 45s) en /api/worker/process.

UPDATE public.webhook_config
SET window_seconds = 30,
    dispatch_immediate = false,
    updated_at = NOW()
WHERE topic = 'items';

INSERT INTO public.webhook_config (topic, window_seconds, dispatch_immediate, enabled, label, updated_at)
VALUES ('worker_active_lease', 45, false, true, NULL, '1970-01-01T00:00:00Z')
ON CONFLICT (topic) DO NOTHING;
