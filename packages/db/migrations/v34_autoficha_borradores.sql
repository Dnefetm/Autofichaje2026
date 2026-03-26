-- v34_autoficha_borradores.sql
-- Tabla para persistencia multi-dispositivo de borradores de Autofichas
-- Permite subir fotos desde celular y continuar la edición en desktop
-- Ejecutar en Supabase SQL Editor (proyecto ryxdqnzyvnrwalylqyvm)

CREATE TABLE IF NOT EXISTS autoficha_borradores (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    operador_id  text        NOT NULL DEFAULT 'operador_1',
    estado       text        NOT NULL DEFAULT 'pendiente'
                             CHECK (estado IN ('pendiente','procesando','listo','guardado','error')),

    -- Entrada (lo que subió el operador)
    input_mode   text        NOT NULL DEFAULT 'file'
                             CHECK (input_mode IN ('file','url')),
    url_origen   text,
    archivos_storage jsonb   DEFAULT '[]'::jsonb,
    -- Cada entrada: {path, url, nombre, tipo, tamano}

    -- Resultado IA (se completa al procesar)
    resultado_ia jsonb,           -- AutofichaResult completo
    editado      jsonb,           -- Ediciones del operador
    confianza    numeric,

    -- Vinculación elegida
    articulo_vinculado text,      -- articulo_id seleccionado
    modo_guardado text            CHECK (modo_guardado IN ('create','update','link_only')),

    -- Metadata
    dispositivo  text,            -- 'desktop', 'mobile', user-agent simplificado
    created_at   timestamptz     DEFAULT now(),
    updated_at   timestamptz     DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_borradores_operador ON autoficha_borradores(operador_id, estado);
CREATE INDEX IF NOT EXISTS idx_borradores_updated  ON autoficha_borradores(updated_at DESC);

-- Trigger para updated_at automático
CREATE OR REPLACE FUNCTION update_borradores_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_borradores_updated_at ON autoficha_borradores;
CREATE TRIGGER trg_borradores_updated_at
    BEFORE UPDATE ON autoficha_borradores
    FOR EACH ROW EXECUTE FUNCTION update_borradores_updated_at();

-- RLS (permisos abiertos — en producción limitar por auth.uid())
ALTER TABLE autoficha_borradores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "borradores_all" ON autoficha_borradores;
CREATE POLICY "borradores_all" ON autoficha_borradores
    FOR ALL USING (true) WITH CHECK (true);
