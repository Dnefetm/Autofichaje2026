-- 1. Add actualizado_el
ALTER TABLE costos_articulo ADD COLUMN IF NOT EXISTS actualizado_el timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION update_actualizado_el()
RETURNS TRIGGER AS $$
BEGIN
    NEW.actualizado_el = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_costos_articulo_actualizado_el ON costos_articulo;
CREATE TRIGGER trg_costos_articulo_actualizado_el
BEFORE UPDATE ON costos_articulo
FOR EACH ROW
EXECUTE FUNCTION update_actualizado_el();

-- 2. Cleanup duplicates in costos_pendientes
DELETE FROM costos_pendientes a 
USING costos_pendientes b 
WHERE a.id < b.id 
  AND a.proveedor = b.proveedor 
  AND a.codigo_excel IS NOT DISTINCT FROM b.codigo_excel 
  AND a.marca_excel IS NOT DISTINCT FROM b.marca_excel 
  AND a.modelo_excel IS NOT DISTINCT FROM b.modelo_excel 
  AND a.tipo_costo = b.tipo_costo 
  AND a.importacion_id = b.importacion_id 
  AND a.resuelto = false 
  AND b.resuelto = false;

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
