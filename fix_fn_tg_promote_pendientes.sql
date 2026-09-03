-- =============================================================================
-- FIX: fn_tg_promote_pendientes — estado_match 'completado' inválido
-- =============================================================================
-- PROBLEMA VALIDADO (error real del usuario al vincular un precio):
--   "new row for relation costos_articulo violates check constraint
--    chk_costos_articulo_estado_match"
--
-- CAUSA: el trigger que copia costos_pendientes -> costos_articulo escribe
--   estado_match = 'completado', pero la regla chk_costos_articulo_estado_match
--   solo permite: sin_match, sugerido, confirmado, rechazado,
--   actualizado_fuerte, cambio_codigo_sugerido, ambiguo, nuevo,
--   descontinuado_por_proveedor, match_exacto, match_similitud.
--   'completado' NO está permitido -> el trigger falla -> se revierte el alias.
--
-- FIX: 'completado' -> 'match_exacto' (valor válido y consistente con el resto
--   del pipeline y con la ruta /vincular).
--   - Idempotente (CREATE OR REPLACE FUNCTION). El trigger existente la usa sola.
--   - Reversible (ver rollback_fn_tg_promote_pendientes.sql).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_tg_promote_pendientes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    -- Mover de costos_pendientes a costos_articulo (upsert)
    INSERT INTO costos_articulo (
        importacion_id, articulo_id, articulo_sugerido_id,
        modelo_excel, marca_excel, codigo_universal_excel, descripcion_excel, nombre_excel,
        tipo_costo, valor, moneda, fuente, puntaje_match, estado_match, vigente, incluye_iva
    )
    SELECT
        cp.importacion_id, NEW.articulo_id, NEW.articulo_id,
        cp.modelo_excel, cp.marca_excel, cp.codigo_excel, '', '',
        cp.tipo_costo, cp.valor, cp.moneda, 'excel', 100, 'match_exacto', true, false
    FROM costos_pendientes cp
    WHERE cp.proveedor = NEW.proveedor
      AND COALESCE(cp.codigo_excel, '') = COALESCE(NEW.codigo_excel, '')
      AND COALESCE(cp.marca_excel, '') = COALESCE(NEW.marca_excel, '')
      AND COALESCE(cp.modelo_excel, '') = COALESCE(NEW.modelo_excel, '')
      AND cp.resuelto = false
    ON CONFLICT (articulo_id, tipo_costo, fuente) DO UPDATE SET
        valor = EXCLUDED.valor,
        moneda = EXCLUDED.moneda,
        importacion_id = EXCLUDED.importacion_id,
        vigente = EXCLUDED.vigente,
        actualizado_el = now();

    -- Marcar como resueltos
    UPDATE costos_pendientes cp
    SET resuelto = true, actualizado_el = now()
    WHERE cp.proveedor = NEW.proveedor
      AND COALESCE(cp.codigo_excel, '') = COALESCE(NEW.codigo_excel, '')
      AND COALESCE(cp.marca_excel, '') = COALESCE(NEW.marca_excel, '')
      AND COALESCE(cp.modelo_excel, '') = COALESCE(NEW.modelo_excel, '')
      AND cp.resuelto = false;

    RETURN NEW;
END;
$$;
