-- v36: Ampliar columnas text en tabla articulos
-- Causa: varchar(255) demasiado corto para descripciones generadas por IA (400+ chars)
-- Se convierte a TEXT para evitar truncamiento o error en inserts/updates.
-- TEXT en PostgreSQL no tiene límite práctico (hasta ~1 GB), más apropiado para texto libre.

-- Columnas confirmadas como varchar(255) susceptibles de overflowear con datos reales:
ALTER TABLE articulos ALTER COLUMN descripcion    TYPE text;
ALTER TABLE articulos ALTER COLUMN nombre         TYPE text;
ALTER TABLE articulos ALTER COLUMN materiales     TYPE text;
ALTER TABLE articulos ALTER COLUMN variante       TYPE text;
ALTER TABLE articulos ALTER COLUMN pais_origen    TYPE text;
ALTER TABLE articulos ALTER COLUMN categoria      TYPE text;

-- Verificar resultado (opcional, ejecutar por separado):
-- SELECT column_name, data_type, character_maximum_length
-- FROM information_schema.columns
-- WHERE table_name = 'articulos'
-- ORDER BY column_name;
