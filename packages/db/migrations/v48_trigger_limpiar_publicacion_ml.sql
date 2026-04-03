-- v48_trigger_limpiar_publicacion_ml.sql
-- Trigger: cuando publicaciones_externas.status_externo cambia a estado terminal
-- (closed, inactive, deleted), limpiar articulos.publicacion_ml si apuntaba a ese item.
--
-- Contexto verificado en DDL:
-- - articulos.publicacion_ml TEXT (v13) — almacena external_item_id (MLM123456)
-- - mapeo_publicacion_articulo.sku_articulo TEXT (v14) — FK a articulos(articulo_id)
--   NOTA: la columna se llama sku_articulo, NO articulo_id
-- - publicaciones_externas.sub_status text[] (v17) — existe
--
-- Activado por: reconcileClosedItems (Capa 2) al actualizar status_externo a 'closed'/'inactive'
-- Efecto: limpia publicacion_ml → la UI deja de mostrar link a publicación muerta

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
      WHERE mpa.sku_articulo = a.articulo_id   -- sku_articulo es el nombre real de la columna (v14)
        AND pe.status_externo = 'active'
        AND pe.external_item_id != NEW.external_item_id
      ORDER BY pe.actualizado_el DESC
      LIMIT 1
    )
    WHERE a.publicacion_ml IS NULL
      AND a.articulo_id IN (
        SELECT mpa2.sku_articulo           -- sku_articulo es el nombre real de la columna (v14)
        FROM mapeo_publicacion_articulo mpa2
        WHERE mpa2.publicacion_id = NEW.id
      );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_limpiar_publicacion_ml ON publicaciones_externas;

CREATE TRIGGER trg_limpiar_publicacion_ml
AFTER UPDATE OF status_externo ON publicaciones_externas
FOR EACH ROW
EXECUTE FUNCTION fn_limpiar_publicacion_ml_en_cierre();
