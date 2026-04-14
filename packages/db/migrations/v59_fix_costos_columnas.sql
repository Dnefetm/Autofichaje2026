-- =============================================================================
-- MIGRACIÓN v59: Correcciones post-v58 y soporte multiples precios
-- =============================================================================
-- 1. confirmar_por: era uuid, debe ser text (se guarda 'operador' o user_id textual)
-- 2. codigo_excel: v58 creó la columna incorrecta. DB ya tiene codigo_universal_excel.
--    Se elimina la duplicada y se usa la que siempre existió.
-- 3. tipo_costo_default en importaciones_excel: permite múltiples tipos separados por coma
--    para recordar que ese proveedor suele traer distribuidor+lista juntos.
-- =============================================================================

-- ─── 1. Cambiar confirmado_por de uuid → text ────────────────────────────────
-- Era uuid, pero al confirmar guardamos 'operador' (texto). Revienta en runtime.
ALTER TABLE costos_articulo
    ALTER COLUMN confirmado_por TYPE text
    USING confirmado_por::text;

COMMENT ON COLUMN costos_articulo.confirmado_por IS
  'ID textual del usuario que confirmó el match (user_id de auth, o operador@sistema si no hay auth)';

-- ─── 2. Eliminar columna codigo_excel agregada por error en v58 ──────────────
-- La columna correcta es codigo_universal_excel (ya existía desde el diseño original).
-- No duplicar.
ALTER TABLE costos_articulo DROP COLUMN IF EXISTS codigo_excel;

-- ─── 3. Ignorar la columna marca_excel de v58 si ya existía ──────────────────
-- El schema original ya la tenía. v58 la intentó agregar con IF NOT EXISTS, OK.

-- ─── Verificación ─────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'costos_articulo'
--   ORDER BY ordinal_position;
--
-- Debe existir: modelo_excel (text), marca_excel (text), codigo_universal_excel (text)
-- NO debe existir: codigo_excel
-- confirmado_por debe ser: character varying / text (NO uuid)
