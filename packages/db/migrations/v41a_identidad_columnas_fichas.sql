-- v41a_identidad_columnas_fichas.sql
-- Paso 1 y 2: Agrega columnas de identidad de producto a fichas_tecnicas
-- y hace backfill desde articulos vinculados.
-- La ficha técnica pasa a ser un documento autónomo con identidad propia.
-- EJECUTAR EN: Supabase SQL Editor (ryxdqnzyvnrwalylqyvm)
-- REQUIERE: v37 ejecutado

-- ── Paso 1: ALTER TABLE (aditivo, no rompe nada) ─────────────────────────────
ALTER TABLE fichas_tecnicas
  ADD COLUMN IF NOT EXISTS marca             text,
  ADD COLUMN IF NOT EXISTS modelo            text,
  ADD COLUMN IF NOT EXISTS variante          text,
  ADD COLUMN IF NOT EXISTS codigo_universal  text,
  ADD COLUMN IF NOT EXISTS categoria         text,
  ADD COLUMN IF NOT EXISTS peso_kg           numeric,
  ADD COLUMN IF NOT EXISTS largo_cm          numeric,
  ADD COLUMN IF NOT EXISTS ancho_cm          numeric,
  ADD COLUMN IF NOT EXISTS alto_cm           numeric,
  ADD COLUMN IF NOT EXISTS materiales        text,
  ADD COLUMN IF NOT EXISTS pais_origen       text;

-- ── Paso 2: Backfill desde artículos vinculados ───────────────────────────────
-- COALESCE: nunca sobrescribe un campo que ya tenga valor (ediciones manuales previas)
UPDATE fichas_tecnicas ft
SET
  marca            = COALESCE(ft.marca,            a.marca),
  modelo           = COALESCE(ft.modelo,           a.modelo),
  variante         = COALESCE(ft.variante,         a.variante),
  codigo_universal = COALESCE(ft.codigo_universal, a.codigo_universal),
  categoria        = COALESCE(ft.categoria,        a.categoria),
  peso_kg          = COALESCE(ft.peso_kg,          a.peso_kg),
  largo_cm         = COALESCE(ft.largo_cm,         a.largo_cm),
  ancho_cm         = COALESCE(ft.ancho_cm,         a.ancho_cm),
  alto_cm          = COALESCE(ft.alto_cm,          a.alto_cm),
  materiales       = COALESCE(ft.materiales,       a.materiales),
  pais_origen      = COALESCE(ft.pais_origen,      a.pais_origen)
FROM articulos a
WHERE ft.articulo_id = a.articulo_id
  AND ft.articulo_id IS NOT NULL;

-- ── Verificación ──────────────────────────────────────────────────────────────
-- SELECT id, nombre_producto, marca, modelo, variante, codigo_universal,
--        peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen
-- FROM fichas_tecnicas
-- ORDER BY created_at DESC;
