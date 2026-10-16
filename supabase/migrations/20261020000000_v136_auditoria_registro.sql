-- v136: Registro de auditorías (precio + publicación)
-- Doble horizonte: cabecera permanente en publicaciones_externas + bitácora rodante (365 días).

-- 1) Cabecera permanente (para filtrar/ordenar sin joins)
ALTER TABLE public.publicaciones_externas
  ADD COLUMN IF NOT EXISTS ultima_auditoria_precio_el     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultima_auditoria_precio_accion TEXT,
  ADD COLUMN IF NOT EXISTS ultima_auditoria_pub_el        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ultima_auditoria_pub_accion    TEXT;

CREATE INDEX IF NOT EXISTS idx_pub_aud_precio ON public.publicaciones_externas (ultima_auditoria_precio_el ASC NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_pub_aud_pub    ON public.publicaciones_externas (ultima_auditoria_pub_el    ASC NULLS FIRST);

-- 2) Bitácora de auditoría (precio + publicación). NO la tocan las purgas de 15 días existentes.
CREATE TABLE IF NOT EXISTS public.publicacion_auditoria_log (
  id             BIGSERIAL PRIMARY KEY,
  publicacion_id UUID NOT NULL REFERENCES public.publicaciones_externas(id) ON DELETE CASCADE,
  ambito         TEXT NOT NULL CHECK (ambito IN ('precio','publicacion')),
  accion         TEXT NOT NULL,
  detalle        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aud_log_pub    ON public.publicacion_auditoria_log (publicacion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aud_log_ambito ON public.publicacion_auditoria_log (ambito, created_at DESC);

-- 3) Retención 365 días (job independiente; no modifica las purgas existentes)
CREATE OR REPLACE PROCEDURE public.sp_limpiar_auditoria_log()
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.publicacion_auditoria_log WHERE created_at < NOW() - INTERVAL '365 days';
END $$;

SELECT cron.schedule('cleanup-auditoria-log', '0 4 * * *', 'CALL public.sp_limpiar_auditoria_log()');

-- 4) Backfill HONESTO (solo acciones humanas; el resto queda NULL = "sin auditar")
-- 4a. Aprobaciones manuales (historial de precios, retención 15 días)
UPDATE public.publicaciones_externas p
SET ultima_auditoria_precio_el = h.max_fecha,
    ultima_auditoria_precio_accion = 'aprobacion_manual'
FROM (SELECT publicacion_id, MAX(created_at) AS max_fecha
      FROM public.publication_pricing_history
      WHERE reason = 'manual_apply'
      GROUP BY publicacion_id) h
WHERE p.id = h.publicacion_id;

-- 4b. Overrides (solo si son más recientes que lo ya cargado)
UPDATE public.publicaciones_externas p
SET ultima_auditoria_precio_el = o.updated_at,
    ultima_auditoria_precio_accion = 'override_guardado'
FROM public.publication_pricing_overrides o
WHERE p.id = o.publicacion_id
  AND (p.ultima_auditoria_precio_el IS NULL OR o.updated_at > p.ultima_auditoria_precio_el);
