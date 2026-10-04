-- =============================================================================
-- Logística Full — Envíos planificados (decisión del operario)
-- =============================================================================
-- El operario decide qué enviar (agrega/quita/ajusta cantidades) sobre la
-- propuesta y confirma una lista final ANTES de crear el envío en el portal de
-- ML. Esta tabla guarda esa decisión (puente entre propuesta y PDF importado).
-- =============================================================================

CREATE TABLE IF NOT EXISTS envios_planificados (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    guia                text,                              -- número de envío (se asigna al importar el PDF)
    estado              text NOT NULL DEFAULT 'borrador',  -- borrador | confirmado | importado | cerrado
    marketplace_id      uuid,
    notas               text,
    creado_por          uuid,
    fecha_creacion      timestamptz NOT NULL DEFAULT now(),
    fecha_confirmacion  timestamptz,
    fecha_importacion   timestamptz,
    fecha_cierre        timestamptz
);

CREATE TABLE IF NOT EXISTS envio_planificado_items (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    envio_id      uuid NOT NULL REFERENCES envios_planificados(id) ON DELETE CASCADE,
    inventory_id  text NOT NULL,                    -- código ML (Full)
    nombre        text,                             -- nombre del producto (snapshot para la UI)
    cantidad      integer NOT NULL DEFAULT 0,       -- decisión del operario (a enviar)
    objetivo      integer,                          -- cantidad sugerida por la propuesta (referencia)
    UNIQUE (envio_id, inventory_id)
);

CREATE INDEX IF NOT EXISTS idx_envio_planificado_items_envio ON envio_planificado_items (envio_id);
CREATE INDEX IF NOT EXISTS idx_envios_planificados_estado ON envios_planificados (estado);
