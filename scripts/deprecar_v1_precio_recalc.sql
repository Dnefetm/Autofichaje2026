-- =============================================================================
-- DEPRECACION v1_precio_recalc_queue (ruta DEAD) - 2026-08-25
-- =============================================================================
-- JUSTIFICACION (docs/flow_hints.yaml, pipeline_routes.v1_precio_recalc_queue):
--   - El motor fn_recalcular_lote usa el esquema VIEJO de reglas_precio
--     (columna 'retenciones' inexistente) -> esta roto.
--   - La cola precio_recalc_queue acumulo ~10,620 pendientes SIN consumidor.
--   - La ruta viva es v3_publication_pricing (fn_recalcular_precio_publicacion).
--
-- EJECUCION MANUAL Y DESTRUCTIVA. Requiere rol con DDL en produccion.
-- Orden seguro: primero deshabilitar el trigger (detiene el sangrado),
-- validar unos dias, y SOLO despues descomentar los DROP.
-- =============================================================================

-- PASO 0 (validacion previa): ambos deben coindicir con "ruta muerta":
--   SELECT count(*) FROM precio_recalc_queue;          -- historico, sin drenar
--   SELECT count(*) FROM jobs WHERE type='sync_price'; -- la ruta viva usa jobs
--   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname='tg_encolar_recalculo';

-- PASO 1 (reversible, bajo riesgo): detener el encolado hacia la ruta muerta.
ALTER TABLE costos_articulo DISABLE TRIGGER tg_encolar_recalculo;

-- Para revertir el paso 1:
-- ALTER TABLE costos_articulo ENABLE TRIGGER tg_encolar_recalculo;

-- PASO 2 (DESTRUCTIVO - descomentar solo tras validar que nada depende de v1):
-- DROP TABLE IF EXISTS precio_recalc_queue;
-- DROP FUNCTION IF EXISTS fn_tg_encolar_recalculo();
-- DROP FUNCTION IF EXISTS fn_recalcular_lote();
-- DROP FUNCTION IF EXISTS claim_precio_recalc();
-- DROP FUNCTION IF EXISTS procesar_precio_recalc_queue();
