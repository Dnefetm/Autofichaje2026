-- v53: Vinculación directa fichas_tecnicas ↔ publicaciones_externas
-- Agrega dos columnas a fichas_tecnicas para registrar la publicación generada.
-- Relación 1:1 por diseño actual (una ficha → una publicación principal).
-- Si en el futuro se requiere N:N, se crea tabla puente fichas_publicaciones.

ALTER TABLE fichas_tecnicas
    ADD COLUMN IF NOT EXISTS publicacion_externa_id uuid
        REFERENCES publicaciones_externas(id)
        ON DELETE SET NULL,                        -- si se borra la pub, la ficha no se pierde
    ADD COLUMN IF NOT EXISTS ml_item_id text;      -- MLM... — acceso directo sin join

COMMENT ON COLUMN fichas_tecnicas.publicacion_externa_id IS
    'FK a publicaciones_externas.id — se llena automáticamente tras publicar en MeLi desde esta ficha';
COMMENT ON COLUMN fichas_tecnicas.ml_item_id IS
    'MeLi item_id (MLM...) — copia desnormalizada para acceso directo sin join';
