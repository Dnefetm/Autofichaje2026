-- v39a_auditoria_fichas.sql
-- FASE 1: Auditoría — queries de solo lectura para ver qué existe
-- NO destruye nada. Ejecutar en Supabase SQL Editor antes de la limpieza.
-- EJECUTAR EN: Supabase SQL Editor (proyecto ryxdqnzyvnrwalylqyvm)

-- ══ 1. Artículos creados por autoficha (buscar fantasmas) ══
-- Fantasmas = articulo_id en fichas_tecnicas + mapeos=0 + imagenes=0 + snapshot_vacio=true
SELECT 
  a.articulo_id,
  a.nombre,
  a.marca,
  a.creado_el,
  (SELECT count(*) FROM fichas_tecnicas ft  WHERE ft.articulo_id   = a.articulo_id) AS fichas,
  (SELECT count(*) FROM mapeo_publicacion_articulo m WHERE m.articulo_id = a.articulo_id) AS mapeos,
  (SELECT count(*) FROM imagenes_articulo i   WHERE i.articulo_id   = a.articulo_id) AS imagenes,
  EXISTS(
    SELECT 1 FROM inventory_snapshot s
    WHERE s.sku = a.articulo_id AND s.physical_stock = 0
  ) AS snapshot_vacio
FROM articulos a
WHERE a.articulo_id IN (
  SELECT DISTINCT articulo_id FROM fichas_tecnicas WHERE articulo_id IS NOT NULL
)
ORDER BY a.creado_el DESC;

-- ══ 2. Fichas técnicas y sus vínculos ══
SELECT 
  ft.id            AS ficha_id,
  ft.articulo_id,
  ft.nombre_producto,
  ft.estado,
  ft.created_at,
  (SELECT count(*) FROM ficha_extracciones fe WHERE fe.ficha_tecnica_id = ft.id) AS extracciones
FROM fichas_tecnicas ft
ORDER BY ft.created_at DESC;

-- ══ 3. Fuentes documento (auditoría OCR) ══
SELECT id, nombre_archivo, estado_procesamiento, created_at
FROM fuentes_documento
ORDER BY created_at DESC
LIMIT 20;

-- ══ 4. Fichas SIN artículo vinculado (futuras fichas en modo draft) ══
SELECT id, nombre_producto, estado, created_at
FROM fichas_tecnicas
WHERE articulo_id IS NULL
ORDER BY created_at DESC;
