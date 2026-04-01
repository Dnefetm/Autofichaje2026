-- =============================================================================
-- MIGRACIÓN v43: Versionar funciones de producción que no están en el repo
-- =============================================================================
-- ESTADO: PLACEHOLDER — requiere acción manual de Comet
--
-- PROBLEMA:
--   Las siguientes funciones/triggers existen en producción de Supabase pero
--   NO están en ninguna migración del repo. Si se hace un redeploy limpio
--   desde migraciones, se pierden y el stock deja de propagarse a MeLi.
--
-- ACCIÓN REQUERIDA (Comet):
--   1. Ejecutar las siguientes queries en el SQL Editor de Supabase PRODUCCIÓN.
--   2. Copiar el resultado completo como contenido de esta migración.
--   3. Commit con mensaje: "fix: versionar fn_encolar_sync_stock y trg_fn_sync_stock prod"
--
-- QUERIES A EJECUTAR EN SUPABASE:
-- =============================================================================

-- Query 1: Extraer fn_encolar_sync_stock
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'fn_encolar_sync_stock';

-- Query 2: Extraer trg_fn_sync_stock (versión PRODUCCIÓN — difiere del repo en v29)
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'trg_fn_sync_stock';

-- Query 3: Verificar y extraer el trigger sobre inventory_snapshot
-- SELECT pg_get_triggerdef(oid)
-- FROM pg_trigger
-- WHERE tgname = 'trg_encolar_sync_stock';

-- Query 4: Verificar los triggers sobre ingresos/egresos para confirmar que
-- coinciden con v29 del repo (o capturar la versión producción si difiere)
-- SELECT tgname, tgrelid::regclass AS tabla, tgenabled
-- FROM pg_trigger
-- WHERE tgname LIKE 'trg_sinc%' OR tgname LIKE 'trg_fn_sync%';

-- =============================================================================
-- RESULTADO ESPERADO:
--   - fn_encolar_sync_stock: función que detecta cambio en inventory_snapshot.physical_stock
--     y crea un job { type: 'sync_stock_mapped', payload: { publicacion_id: ... } }
--     en la tabla `jobs`.
--   - trg_encolar_sync_stock: trigger AFTER UPDATE ON inventory_snapshot FOR EACH ROW
--     que llama a fn_encolar_sync_stock cuando physical_stock cambia.
--   - trg_fn_sync_stock (prod): igual que v29 pero con skip-logic adicional que
--     compara OLD.cantidad vs NEW.cantidad para evitar recálculos innecesarios.
--
-- NOTAS PARA COMET:
--   - La versión de producción de trg_fn_sync_stock tiene skip-logic por cantidad
--     que NO está en v29_triggers_stock.sql del repo. Eso es intencional y mejor.
--     Al versionar, guardar la versión de producción (la mejor), no la del repo.
--   - Esta migración debe ejecutarse DESPUES de v29_triggers_stock.sql para 
--     que reemplace/actualice la función si el orden importa.
--   - Nombrarla v44 si v43 ya fue tomado por otro ticket.
-- =============================================================================

-- CONTENIDO PENDIENTE — pegar aquí el output de las queries anteriores:

