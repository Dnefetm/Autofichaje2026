-- Migración V27b — Reparar 3 FKs de articulos(sku) → articulos(articulo_id)
-- Propósito: Las 3 FKs activas que aún apuntan a articulos(sku) deben
-- redirigirse a articulos(articulo_id) (el PK real en producción).
--
-- PREREQUISITO: Ejecutar PRIMERO las queries de validación de orphans.
-- Si alguna retorna filas, NO ejecutar este script.
-- PREREQUISITO: v27a_trigger_protector.sql ya ejecutado.
--
-- ══════════════════════════════════════════════════════════════════════
-- PASO 1: VALIDACIÓN DE ORPHANS (ejecutar por separado, verificar 0 filas)
-- ══════════════════════════════════════════════════════════════════════

-- SELECT ic.sku FROM informacion_comercial ic
-- LEFT JOIN articulos a ON ic.sku = a.articulo_id
-- WHERE a.articulo_id IS NULL;

-- SELECT sp.sku_articulo FROM stock_por_ubicacion sp
-- LEFT JOIN articulos a ON sp.sku_articulo = a.articulo_id
-- WHERE a.articulo_id IS NULL;

-- SELECT tr.sku_inventario FROM tareas_recoleccion_full tr
-- LEFT JOIN articulos a ON tr.sku_inventario = a.articulo_id
-- WHERE a.articulo_id IS NULL;

-- ══════════════════════════════════════════════════════════════════════
-- PASO 2: MIGRACIÓN ATÓMICA (ejecutar completo — ROLLBACK automático si falla)
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. informacion_comercial: sku → articulos(articulo_id)
ALTER TABLE informacion_comercial
    DROP CONSTRAINT IF EXISTS informacion_comercial_sku_fkey;
ALTER TABLE informacion_comercial
    ADD CONSTRAINT informacion_comercial_articulo_id_fkey
    FOREIGN KEY (sku) REFERENCES articulos(articulo_id);

-- 2. stock_por_ubicacion: sku_articulo → articulos(articulo_id)
ALTER TABLE stock_por_ubicacion
    DROP CONSTRAINT IF EXISTS stock_por_ubicacion_sku_articulo_fkey;
ALTER TABLE stock_por_ubicacion
    ADD CONSTRAINT stock_por_ubicacion_articulo_id_fkey
    FOREIGN KEY (sku_articulo) REFERENCES articulos(articulo_id);

-- 3. tareas_recoleccion_full: sku_inventario → articulos(articulo_id)
ALTER TABLE tareas_recoleccion_full
    DROP CONSTRAINT IF EXISTS tareas_recoleccion_full_sku_inventario_fkey;
ALTER TABLE tareas_recoleccion_full
    ADD CONSTRAINT tareas_recoleccion_full_articulo_id_fkey
    FOREIGN KEY (sku_inventario) REFERENCES articulos(articulo_id);

COMMIT;

-- Nota: NO se agrega ON DELETE CASCADE (más seguro).
-- Si se necesita en el futuro, se agrega por separado y explícitamente.

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN POST-EJECUCIÓN (debe retornar 0 filas)
-- ══════════════════════════════════════════════════════════════════════

-- SELECT kcu.table_name, kcu.column_name, ccu.column_name AS ref
-- FROM information_schema.referential_constraints rc
-- JOIN information_schema.key_column_usage kcu
--     ON kcu.constraint_name = rc.constraint_name
-- JOIN information_schema.constraint_column_usage ccu
--     ON ccu.constraint_name = rc.unique_constraint_name
-- WHERE ccu.table_name = 'articulos' AND ccu.column_name = 'sku';

-- ── REVERSIÓN ──────────────────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE informacion_comercial
--     DROP CONSTRAINT IF EXISTS informacion_comercial_articulo_id_fkey;
-- ALTER TABLE informacion_comercial
--     ADD CONSTRAINT informacion_comercial_sku_fkey
--     FOREIGN KEY (sku) REFERENCES articulos(sku);
-- ALTER TABLE stock_por_ubicacion
--     DROP CONSTRAINT IF EXISTS stock_por_ubicacion_articulo_id_fkey;
-- ALTER TABLE stock_por_ubicacion
--     ADD CONSTRAINT stock_por_ubicacion_sku_articulo_fkey
--     FOREIGN KEY (sku_articulo) REFERENCES articulos(sku);
-- ALTER TABLE tareas_recoleccion_full
--     DROP CONSTRAINT IF EXISTS tareas_recoleccion_full_articulo_id_fkey;
-- ALTER TABLE tareas_recoleccion_full
--     ADD CONSTRAINT tareas_recoleccion_full_sku_inventario_fkey
--     FOREIGN KEY (sku_inventario) REFERENCES articulos(sku);
-- COMMIT;
