-- v45_campos_regulatorios_fichas.sql
-- Agrega 4 columnas de contenido regulatorio / etiquetado a fichas_tecnicas.
-- Sigue el mismo patrón de columnas propias de v41a (no acumula en atributos_extras ni en JSONB).
-- EJECUTAR EN: Supabase SQL Editor (ryxdqnzyvnrwalylqyvm)
-- REQUIERE: v41a ejecutado
-- SEGURO: ADD COLUMN IF NOT EXISTS — no destructivo, no requiere downtime.

ALTER TABLE fichas_tecnicas
  ADD COLUMN IF NOT EXISTS informacion_normativa       text,
  ADD COLUMN IF NOT EXISTS instrucciones_uso           text,
  ADD COLUMN IF NOT EXISTS leyendas_precautorias       text,
  ADD COLUMN IF NOT EXISTS indicaciones_almacenamiento text;

COMMENT ON COLUMN fichas_tecnicas.informacion_normativa IS
'Textos que el fabricante/importador está obligado a incluir por ley en el etiquetado:
número de registro sanitario, NOM de producto aplicable, denominación legal,
contenido neto, nombre y dirección del responsable.';

COMMENT ON COLUMN fichas_tecnicas.instrucciones_uso IS
'Pasos o modo de empleo dirigidos al usuario final. No incluye advertencias de riesgo
ni especificaciones técnicas.';

COMMENT ON COLUMN fichas_tecnicas.leyendas_precautorias IS
'Advertencias de riesgo/peligro del etiquetado obligatorio: frases H/P del sistema GHS,
"Manténgase fuera del alcance de los niños", clasificación de riesgo NOM-018-STPS.
Distinto de precauciones (campo general de uso).';

COMMENT ON COLUMN fichas_tecnicas.indicaciones_almacenamiento IS
'Condiciones de conservación del producto: temperatura, humedad, luz, ventilación,
separación de incompatibles, fecha de caducidad o vida útil.';

-- ── Verificación ──────────────────────────────────────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'fichas_tecnicas'
--   AND column_name IN (
--     'informacion_normativa','instrucciones_uso',
--     'leyendas_precautorias','indicaciones_almacenamiento'
--   );
