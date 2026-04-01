-- v47: Vincular el trigger de extracción de campos regulatorios a fichas_tecnicas
-- Ejecutar DESPUÉS de v45 (columnas) y v46 (función guardar_ficha_autoficha)
-- La función trg_extraer_campos_regulatorios ya existe (creada en v45/v46)
-- Solo faltaba el CREATE TRIGGER que la vincule a la tabla.

CREATE TRIGGER trg_extraer_campos_regulatorios
  BEFORE INSERT OR UPDATE ON fichas_tecnicas
  FOR EACH ROW
  EXECUTE FUNCTION trg_extraer_campos_regulatorios();
