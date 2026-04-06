-- v47_verificar_v46.sql
-- DIAGNÓSTICO: Verifica qué versión del RPC guardar_ficha_autoficha está activa.
-- OBJETIVO: Confirmar que v46 está desplegado (campos regulatorios incluidos).
-- EJECUTAR EN: Supabase SQL Editor (ryxdqnzyvnrwalylqyvm)
--
-- PASO 1: Verificar versión activa
-- Ejecuta esta query primero. Si el resultado CONTIENE 'informacion_normativa' → v46 OK.
-- Si NO lo contiene → está activo v41b o anterior → ejecutar el bloque de v46 de abajo.

SELECT
    CASE WHEN prosrc LIKE '%informacion_normativa%' THEN 'v46 ✅ — campos regulatorios incluidos'
         WHEN prosrc LIKE '%pais_origen%'            THEN 'v41b ⚠️  — FALTA v46 (campos regulatorios NULL)'
         ELSE                                              'versión desconocida ❌'
    END AS version_activa,
    CASE WHEN prosrc LIKE '%informacion_normativa%' THEN 'OK — no se requiere re-ejecutar'
         ELSE                                            'ACCIÓN REQUERIDA: ejecutar v46_rpc_regulatorio.sql'
    END AS accion
FROM pg_proc
WHERE proname = 'guardar_ficha_autoficha';

-- PASO 2: Si la acción dice "ACCIÓN REQUERIDA", ejecutar el contenido completo de:
--   packages/db/migrations/v46_rpc_regulatorio.sql
-- en el mismo panel del SQL Editor de Supabase.

-- PASO 3: Backfill de fichas existentes con estado 'publicada' → 'publicado'
-- (parte del Fix 2.2 — corrige el vocabulario de estados)
-- SEGURO: solo renombra el valor, no altera la lógica.
UPDATE fichas_tecnicas
SET estado = 'publicado'
WHERE estado = 'publicada';

-- Ver cuántas fichas se actualizaron:
SELECT estado, COUNT(*) FROM fichas_tecnicas GROUP BY estado ORDER BY estado;
