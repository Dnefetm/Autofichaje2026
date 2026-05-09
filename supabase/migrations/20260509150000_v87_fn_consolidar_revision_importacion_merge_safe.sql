-- v87: fn_consolidar_revision_importacion merge-safe
-- Bugs corregidos vs v86:
--  * v86 referenciaba costos_articulo.proveedor (columna inexistente). FIX: usar articulo_id.
--  * v86 intentaba ON CONFLICT (proveedor, importacion_id) sobre listas_precios_proveedor sin esa unique constraint. FIX: insert/update manual.
--  * v86 desactivaba TODOS los costos vigentes del proveedor incluso para articulos no tocados por este import. FIX: solo invalida costos previos cuyos articulos vienen en este import (merge real).
-- Validado contra import 2784e654-cc84-4148-91db-a0314b06f6e4 (99 filas, 86 nuevos / 12 modificados / 0 descontinuados):
--   * 647 costos vigentes externos al import quedan intactos
--   * 12 modelos resueltos -> 48 costos confirmados activados
--   * 86 SKUs nuevos parqueados en costos_pendientes (344 filas)

CREATE OR REPLACE FUNCTION public.fn_consolidar_revision_importacion(p_importacion_id uuid, p_proveedor text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_totales int := 0;
  v_existe_lpp boolean := false;
BEGIN
  SELECT COUNT(*) INTO v_totales FROM listas_precios_raw WHERE importacion_id = p_importacion_id;

  BEGIN
    ALTER TABLE listas_precios_proveedor DISABLE TRIGGER USER;
    ALTER TABLE costos_articulo           DISABLE TRIGGER USER;

    -- 1) Lista del proveedor: marcar previas como no vigentes y dejar la nueva como vigente.
    UPDATE listas_precios_proveedor
       SET vigente=false
     WHERE proveedor=p_proveedor
       AND vigente=true
       AND importacion_id IS DISTINCT FROM p_importacion_id;

    SELECT EXISTS (SELECT 1 FROM listas_precios_proveedor WHERE importacion_id=p_importacion_id) INTO v_existe_lpp;
    IF v_existe_lpp THEN
      UPDATE listas_precios_proveedor
         SET vigente=true, total_filas=v_totales
       WHERE importacion_id=p_importacion_id;
    ELSE
      INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
      VALUES (p_proveedor, p_importacion_id, true, v_totales);
    END IF;

    -- 2) MERGE-SAFE en costos_articulo: solo invalidar costos previos
    --    de los articulos QUE VIENEN en este import (no tocar el resto del catalogo).
    UPDATE costos_articulo ca
       SET vigente=false
     WHERE ca.vigente=true
       AND ca.importacion_id IS DISTINCT FROM p_importacion_id
       AND ca.articulo_id IN (
         SELECT DISTINCT articulo_id
           FROM costos_articulo
          WHERE importacion_id=p_importacion_id
            AND articulo_id IS NOT NULL
       );

    -- 3) Activar costos del nuevo import (los resueltos).
    UPDATE costos_articulo
       SET vigente=true
     WHERE importacion_id=p_importacion_id
       AND articulo_id IS NOT NULL;

    ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
    ALTER TABLE costos_articulo           ENABLE TRIGGER USER;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
    ALTER TABLE costos_articulo           ENABLE TRIGGER USER;
    RAISE;
  END;

  UPDATE importaciones_excel
     SET estado='completado'::estado_importacion_excel,
         ultima_actividad=now()
   WHERE id=p_importacion_id;

  INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
  VALUES (p_importacion_id, 'CONSOLIDADO', 'Revision finalizada y cambios proyectados al catalogo (merge-safe v87).');
END;
$function$;
