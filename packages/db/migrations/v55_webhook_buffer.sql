-- ============================================================
-- v55: Push-First Webhook Architecture
--
-- Crea dos tablas:
--   1. webhook_buffer  — buffer por recurso para consolidar eventos
--   2. webhook_config  — configuración de ventanas por topic (panel de control)
-- ============================================================

-- ─── TABLA 1: Buffer por recurso ─────────────────────────────────────────────
-- Una fila por combinación (topic + resource_id).
-- Cuando llega una notificación repetida, se hace UPSERT actualizando
-- last_seen_at y repeat_count sin insertar duplicados.
CREATE TABLE IF NOT EXISTS webhook_buffer (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    topic               text        NOT NULL,
    resource_id         text        NOT NULL,
    user_id             text,                           -- seller_id de MeLi
    priority            integer     NOT NULL DEFAULT 2, -- 0=órdenes, 1=stock, 2=items, 3=metadata
    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    last_processed_at   timestamptz,
    repeat_count        integer     NOT NULL DEFAULT 1,
    status              text        NOT NULL DEFAULT 'pending',  -- pending | done
    next_eligible_at    timestamptz NOT NULL DEFAULT now(),
    last_payload        jsonb,
    UNIQUE (topic, resource_id)
);

-- Índice para el worker que consulta ¿qué jobs ya tienen cobertura?
CREATE INDEX IF NOT EXISTS idx_wb_pending_eligible
    ON webhook_buffer (priority, next_eligible_at, status)
    WHERE status = 'pending';

-- ─── TABLA 2: Configuración de ventanas por topic ────────────────────────────
-- Una fila por topic. El usuario edita window_seconds desde el panel.
-- Si no hay fila, se usan los defaults del código (fallback seguro).
CREATE TABLE IF NOT EXISTS webhook_config (
    topic               text        PRIMARY KEY,
    window_seconds      integer     NOT NULL DEFAULT 180,  -- ventana de consolidación en segundos
    dispatch_immediate  boolean     NOT NULL DEFAULT false, -- true = dispatch worker inmediato (solo P0)
    enabled             boolean     NOT NULL DEFAULT true,
    label               text,                              -- nombre legible para el panel
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Insertar configuración base — P0 inmediato, resto espera el cron de 1 min
INSERT INTO webhook_config (topic, window_seconds, dispatch_immediate, enabled, label)
VALUES
    ('orders_v2',    0,   true,  true, 'Órdenes y pagos'),
    ('orders',       0,   true,  true, 'Órdenes (legacy)'),
    ('items',        180, false, true, 'Publicaciones (precio, stock, logística)'),
    ('questions',    300, false, true, 'Preguntas y mensajes'),
    ('payments',     0,   true,  true, 'Pagos')
ON CONFLICT (topic) DO NOTHING;
