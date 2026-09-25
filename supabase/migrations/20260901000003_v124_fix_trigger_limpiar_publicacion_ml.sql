-- =============================================================================
-- MIGRACIÓN v124: Corrige el trigger fn_limpiar_publicacion_ml_en_cierre
-- =============================================================================
-- CAUSA RAÍZ (error 42703 "column mpa2.sku_articulo does not exist"):
--   La función referenciaba mapeo_publicacion_articulo.sku_articulo, columna que
--   fue RENOMBRADA a articulo_id en la migración v15.
--
-- IMPACTO: todo UPDATE de publicaciones_externas.status_externo hacia un estado
--   terminal (closed/inactive/deleted) fallaba y revertía la transacción.
--   Por eso las publicaciones eliminadas en MeLi ("fantasmas") nunca se marcaban
--   cerradas en la BD y seguían bloqueando la republicación con el mensaje
--   "Ya existe una publicación activa...".
--
-- FIX: reemplazar sku_articulo -> articulo_id en la función.

CREATE OR REPLACE FUNCTION fn_limpiar_publicacion_ml_en_cierre()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo actuar cuando status_externo cambia a estado terminal
  IF NEW.status_externo IN ('closed', 'inactive', 'deleted')
     AND (OLD.status_externo IS NULL
          OR OLD.status_externo NOT IN ('closed', 'inactive', 'deleted')) THEN

    -- 1. Limpiar articulos.publicacion_ml si apuntaba a este item
    UPDATE articulos
    SET publicacion_ml = NULL
    WHERE publicacion_ml = NEW.external_item_id;

    -- 2. Si el articulo tiene OTRA publicacion activa en cualquier cuenta,
    --    apuntar publicacion_ml a esa (conveniencia, no critico)
    UPDATE articulos a
    SET publicacion_ml = (
      SELECT pe.external_item_id
      FROM publicaciones_externas pe
      JOIN mapeo_publicacion_articulo mpa ON mpa.publicacion_id = pe.id
      WHERE mpa.articulo_id = a.articulo_id
        AND pe.status_externo = 'active'
        AND pe.external_item_id != NEW.external_item_id
      ORDER BY pe.actualizado_el DESC
      LIMIT 1
    )
    WHERE a.publicacion_ml IS NULL
      AND a.articulo_id IN (
        SELECT mpa2.articulo_id
        FROM mapeo_publicacion_articulo mpa2
        WHERE mpa2.publicacion_id = NEW.id
      );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Reasegurar que el trigger existe y apunta a la función corregida (idempotente)
DROP TRIGGER IF EXISTS trg_limpiar_publicacion_ml ON publicaciones_externas;
CREATE TRIGGER trg_limpiar_publicacion_ml
AFTER UPDATE OF status_externo ON publicaciones_externas
FOR EACH ROW
EXECUTE FUNCTION fn_limpiar_publicacion_ml_en_cierre();
