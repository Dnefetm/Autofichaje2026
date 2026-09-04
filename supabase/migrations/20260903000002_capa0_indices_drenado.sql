-- =============================================================================
-- MIGRACIÓN (append-only) Capa 0 — parte 1: Índices de rendimiento + drenado
-- =============================================================================
-- Objetivo: acelerar las consultas del módulo de precios (hub, vinculación,
-- resumen) y activar el drenado automático de costos_pendientes.
--
-- TODO es idempotente (IF NOT EXISTS / DO block). No toca datos.
-- NO edita migraciones anteriores. Reversible (ver rollback al final).
--
-- Índices:
--   - listas_precios_raw: (importacion_id, fila_num) para paginación/orden
--     + GIN sobre payload para búsqueda de texto.
--   - costos_pendientes: (proveedor, resuelto) para el drenado y conteos.
--   - articulos: (codigo_universal) y (marca, modelo) para matching.
--
-- Drenado: programa el cron cada 15 min. Marca: si no quieres el cron automático
-- aún, ejecuta SOLO la sección de índices (hasta el comentario CRON).
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ÍNDICES (seguros, idempotentes)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_lpr_importacion_fila
    ON public.listas_precios_raw (importacion_id, fila_num);

CREATE INDEX IF NOT EXISTS ix_lpr_payload_gin
    ON public.listas_precios_raw USING gin (payload);

CREATE INDEX IF NOT EXISTS ix_cp_proveedor_resuelto
    ON public.costos_pendientes (proveedor, resuelto) WHERE resuelto = false;

CREATE INDEX IF NOT EXISTS ix_cp_importacion
    ON public.costos_pendientes (importacion_id);

CREATE INDEX IF NOT EXISTS ix_art_codigo_universal
    ON public.articulos (codigo_universal);

CREATE INDEX IF NOT EXISTS ix_art_marca_modelo
    ON public.articulos (marca, modelo);

-- ---------------------------------------------------------------------------
-- 2. CRON DE DRENADO (opcional — descomentar/omitir según decisión)
-- ---------------------------------------------------------------------------
-- DO $$
-- BEGIN
--     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain_costos_15min') THEN
--         PERFORM cron.unschedule('drain_costos_15min');
--     END IF;
--     PERFORM cron.schedule('drain_costos_15min', '*/15 * * * *',
--         'SELECT public.fn_drain_costos_pendientes_sin_match()');
-- END $$;

COMMIT;

-- =============================================================================
-- ROLLBACK (eliminar los índices creados; el cron se quita con unschedule)
-- =============================================================================
-- DROP INDEX IF EXISTS public.ix_lpr_importacion_fila;
-- DROP INDEX IF EXISTS public.ix_lpr_payload_gin;
-- DROP INDEX IF EXISTS public.ix_cp_proveedor_resuelto;
-- DROP INDEX IF EXISTS public.ix_cp_importacion;
-- DROP INDEX IF EXISTS public.ix_art_codigo_universal;
-- DROP INDEX IF EXISTS public.ix_art_marca_modelo;
-- SELECT cron.unschedule('drain_costos_15min');
