-- =============================================================================
-- MIGRACIÓN v56: Pipeline de importación de precios del proveedor
-- =============================================================================
-- PROPÓSITO:
--   Extiende el schema para soportar el flujo de subida de Excel de costos:
--   importaciones_excel → costos_articulo (matching) → revisión humana
--
-- TABLAS EXISTENTES MODIFICADAS:
--   - importaciones_excel: agrega tipo_costo_default (memoria por proveedor)
--
-- OBJETOS NUEVOS:
--   - v_costos_pendientes: vista para el dashboard de revisión
-- =============================================================================

-- ─── 1. Campo tipo_costo_default en importaciones_excel ─────────────────────
-- Permite recordar el tipo de costo habitual de cada proveedor para sugerirlo
-- la próxima vez que se suba un Excel del mismo proveedor.

ALTER TABLE importaciones_excel
  ADD COLUMN IF NOT EXISTS tipo_costo_default text;

COMMENT ON COLUMN importaciones_excel.tipo_costo_default IS
  'Tipo de costo habitual de este proveedor (distribuidor, subdistribuidor, lista, mayoreo, etc.)
   Se rellena tras el primer mapeo exitoso y se sugiere en subidas futuras del mismo proveedor.';

-- ─── 2. Vista v_costos_pendientes ───────────────────────────────────────────
-- Usada por el dashboard de revisión de matches.
-- NOTA: estado_match en costos_articulo usa: sin_match | sugerido | confirmado | rechazado
-- La vista filtra solo los que aún no han sido resueltos por un humano.

CREATE OR REPLACE VIEW v_costos_pendientes AS
SELECT
  ca.id,
  ca.importacion_id,
  ca.articulo_id,
  ca.articulo_sugerido_id,
  ca.modelo_excel,           -- valor crudo del Excel
  ca.tipo_costo,
  ca.valor,
  ca.moneda,
  ca.fuente,
  ca.puntaje_match,
  ca.estado_match,
  ca.vigente,
  ca.confirmado_por,
  ca.creado_el,

  -- Datos del artículo confirmado (si ya fue linkeado)
  a.nombre       AS articulo_nombre,
  a.marca        AS articulo_marca,
  a.modelo       AS articulo_modelo,

  -- Datos del archivo de origen
  ie.nombre_archivo  AS importacion_nombre,
  ie.proveedor       AS importacion_proveedor,
  ie.tipo_costo_default
FROM costos_articulo ca
JOIN importaciones_excel ie ON ca.importacion_id = ie.id
LEFT JOIN articulos a ON ca.articulo_id = a.articulo_id
WHERE ca.estado_match IN ('sin_match', 'sugerido')
  AND ca.confirmado_por IS NULL
ORDER BY ca.puntaje_match DESC NULLS LAST, ca.creado_el DESC;

-- ─── 3. Índice auxiliar para el matching ─────────────────────────────────────
-- Acelera búsquedas de costos por importación + estado

CREATE INDEX IF NOT EXISTS idx_costos_importacion_estado
  ON costos_articulo (importacion_id, estado_match);

-- ─── Verificación post-aplicación ────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'importaciones_excel' AND column_name = 'tipo_costo_default';
--
-- SELECT count(*) FROM v_costos_pendientes;
