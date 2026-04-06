-- v49_fix_check_missing_snapshots.sql
-- Corrige el bug en la función check_missing_snapshots()
-- La versión anterior tenía un alias de tabla corrupto ('aaguid' en lugar de 'a')
-- que causaba el error: "42P01: missing FROM-clause entry for table a"
--
-- Ejecutar en Supabase SQL Editor para corregir la función.

CREATE OR REPLACE FUNCTION check_missing_snapshots()
RETURNS TABLE(articulo_id TEXT, nombre TEXT, tiene_mapeo BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT a.articulo_id, a.nombre,
    EXISTS(
      SELECT 1 FROM mapeo_publicacion_articulo m
      WHERE m.articulo_id = a.articulo_id
    ) as tiene_mapeo
  FROM articulos a
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory_snapshot i WHERE i.sku = a.articulo_id
  )
  AND (a.nombre NOT LIKE '%PLACEHOLDER%' OR a.nombre IS NULL);
END;
$$ LANGUAGE plpgsql;

-- Verificación: debe retornar 0 filas si el bootstrap está completo
-- SELECT * FROM check_missing_snapshots();
