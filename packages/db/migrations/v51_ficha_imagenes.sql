-- v51_ficha_imagenes.sql
-- Tabla de imágenes vinculadas a fichas técnicas.
-- Permite gestión de imágenes independiente del catálogo maestro.
-- Almacenamiento: Supabase Storage bucket 'ficha-imagenes' (WebP comprimido).
-- 2026-04-07

-- ── Tabla principal ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ficha_imagenes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ficha_id        uuid NOT NULL REFERENCES public.fichas_tecnicas(id) ON DELETE CASCADE,

    -- URL pública de acceso (Storage o externa)
    url             text NOT NULL,
    -- Ruta interna en Storage (null si es URL externa no guardada)
    storage_path    text,

    -- Orden de presentación (0 = imagen principal para MeLi)
    orden           integer NOT NULL DEFAULT 0,

    -- Clasificación del tipo de imagen
    tipo            text NOT NULL DEFAULT 'producto'
                    CHECK (tipo IN ('producto', 'empaque', 'etiqueta', 'ambiente', 'detalle')),

    -- Metadatos técnicos
    formato         text,           -- 'webp' | 'jpeg' | 'png'
    ancho_px        integer,
    alto_px         integer,
    tamano_bytes    bigint,

    -- Origen de la imagen
    fuente          text DEFAULT 'manual'
                    CHECK (fuente IN ('manual', 'url_directa', 'extraccion_web', 'catalogo')),
    url_original    text,           -- URL de origen si vino de extracción web

    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Índice principal
CREATE INDEX IF NOT EXISTS idx_ficha_imagenes_ficha_orden
    ON public.ficha_imagenes (ficha_id, orden);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.ficha_imagenes ENABLE ROW LEVEL SECURITY;

-- Lectura pública (las imágenes son públicas por diseño)
CREATE POLICY "ficha_imagenes_select_all"
    ON public.ficha_imagenes FOR SELECT
    TO authenticated, anon
    USING (true);

-- Escritura solo para usuarios autenticados
CREATE POLICY "ficha_imagenes_insert_authenticated"
    ON public.ficha_imagenes FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "ficha_imagenes_update_authenticated"
    ON public.ficha_imagenes FOR UPDATE
    TO authenticated
    USING (true);

CREATE POLICY "ficha_imagenes_delete_authenticated"
    ON public.ficha_imagenes FOR DELETE
    TO authenticated
    USING (true);

-- ── Storage bucket ────────────────────────────────────────────────────────────
-- Ejecutar manualmente en Supabase Dashboard > Storage si no existe:
-- Bucket: 'ficha-imagenes' | Public: true | Max file size: 5MB | Allowed MIME: image/*
-- O con Supabase Admin API:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('ficha-imagenes', 'ficha-imagenes', true)
-- ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.ficha_imagenes IS
    'Imágenes vinculadas a fichas técnicas. Almacenadas en WebP en Storage bucket ficha-imagenes.';
