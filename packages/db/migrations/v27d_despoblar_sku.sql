-- Migración V27d — Despoblar articulos.sku
-- Propósito: Vaciar la columna sku y relajar NOT NULL.
-- La columna NO se elimina — queda inerte, lista para DROP futuro.
--
-- PREREQUISITO OBLIGATORIO:
--   1. v27c_validacion.sql retorna 0 filas en Query 1 (ninguna FK apunta a articulos(sku))
--   2. Han pasado al menos 3-5 días de monitoreo sin incidentes desde Fase 4
--
-- Si alguna FK todavía apunta a articulos(sku): NO ejecutar este script.

-- ══════════════════════════════════════════════════════════════════════
-- PASO 5.1 — Eliminar trigger protector (ya no se necesita)
-- ══════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_sync_sku_before_insert ON articulos;
DROP FUNCTION IF EXISTS fn_sync_sku_from_articulo_id();

-- ══════════════════════════════════════════════════════════════════════
-- PASO 5.2 — Relajar constraint NOT NULL primero (necesario antes del UPDATE)
-- BUGFIX: el UPDATE SET NULL fallaba si se ejecutaba con NOT NULL activo
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE articulos ALTER COLUMN sku DROP NOT NULL;

-- ══════════════════════════════════════════════════════════════════════
-- PASO 5.3 — Vaciar la columna
-- ══════════════════════════════════════════════════════════════════════
UPDATE articulos SET sku = NULL;

-- Verificación post-ejecución (sku_nulls debe ser = total_articulos):
-- SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE sku IS NULL) AS sku_nulls FROM articulos;

-- ── REVERSIÓN ──────────────────────────────────────────────────────────────
-- UPDATE articulos SET sku = articulo_id;
-- ALTER TABLE articulos ALTER COLUMN sku SET NOT NULL;
-- (Re-crear trigger si se necesita: ejecutar v27a_trigger_protector.sql)
