-- Migración V27c — Validación: confirmar que nada apunta a articulos(sku)
-- Ejecutar después de v27b_fix_fks.sql
-- CRITERIO: Ambas queries deben retornar 0 filas la primera, y solo articulo_id la segunda.

-- ══════════════════════════════════════════════════════════════════════
-- QUERY 1: Debe retornar 0 filas — ninguna FK apunta a articulos(sku)
-- ══════════════════════════════════════════════════════════════════════
SELECT kcu.table_name, kcu.column_name, ccu.column_name AS ref
FROM information_schema.referential_constraints rc
JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = rc.unique_constraint_name
WHERE ccu.table_name = 'articulos' AND ccu.column_name = 'sku';

-- ══════════════════════════════════════════════════════════════════════
-- QUERY 2: Todas las filas deben mostrar ref_column = 'articulo_id'
-- ══════════════════════════════════════════════════════════════════════
SELECT rc.constraint_name,
       kcu.table_name,
       kcu.column_name   AS local_column,
       ccu.column_name   AS ref_column
FROM information_schema.referential_constraints rc
JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = rc.unique_constraint_name
WHERE ccu.table_name = 'articulos'
ORDER BY kcu.table_name;

-- ══════════════════════════════════════════════════════════════════════
-- QUERY 3 (complementaria): Verificar que sku sigue poblada (seguro antes de Fase 5)
-- ══════════════════════════════════════════════════════════════════════
SELECT
    COUNT(*)                                       AS total_articulos,
    COUNT(*) FILTER (WHERE sku IS NULL)            AS sku_nulls,
    COUNT(*) FILTER (WHERE sku = articulo_id)      AS sku_igual_articulo_id,
    COUNT(*) FILTER (WHERE sku != articulo_id)     AS sku_diferente
FROM articulos;
-- Esperado: sku_nulls = 0, sku_igual_articulo_id = total, sku_diferente = 0
