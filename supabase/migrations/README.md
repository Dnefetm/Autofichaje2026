# Migraciones de base de datos

## Cómo se aplican (IMPORTANTE)

Las migraciones de este proyecto se aplican **manualmente** en
Supabase Dashboard → SQL Editor.

**NO usar `supabase db push`**: el historial de migraciones está inconsistente
(aplicación manual + mezcla ad-hoc vía `exec_sql`), y un `db push` podría
re-aplicar migraciones viejas y romper producción.

## Reglas

1. Cada migración nueva lleva **timestamp** en el nombre:
   `YYYYMMDDHHMMSS_descripcion.sql`.
2. Cada migración debe ser **idempotente** (`CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`, bloques `DO $$ ... $$` con guards).
3. Al aplicar a mano, correr después `verificacion_migraciones.sql` (o un check
   equivalente) para confirmar que quedó bien.
4. **No borrar ni reescribir** una migración ya aplicada. Las correcciones van en
   una migración nueva.

## Archivos

- `*.sql` con timestamp = migraciones aplicadas (registro histórico, no re-aplicar).
- `verificacion_migraciones.sql` = checks post-migración.
