-- v38_limpiar_atributos_duplicados.sql
-- Limpia claves en atributos_dinamicos que duplican datos ya visibles
-- desde la relación articulos (EAN, categoría, dimensiones, peso).
-- También rellena articulos.modelo donde está NULL y el articulo_id puede contenerlo.

-- ─── 1. Eliminar keys duplicadas de atributos_dinamicos ───────────────────────

-- Las siguientes keys duplican datos que ya se muestran desde articulos.*
-- en la sección Identidad del producto:
--   "Código de barras" / "Código de barras (EAN)" → articulos.codigo_universal
--   "Categoría"                                   → articulos.categoria
--   "Largo (cm)"                                  → articulos.largo_cm
--   "Ancho (cm)"                                  → articulos.ancho_cm
--   "Alto (cm)"                                   → articulos.alto_cm
--   "Peso (kg)"                                   → articulos.peso_kg

UPDATE fichas_tecnicas
SET atributos_dinamicos = atributos_dinamicos
    - 'Código de barras'
    - 'Código de barras (EAN)'
    - 'Categoría'
    - 'Largo (cm)'
    - 'Ancho (cm)'
    - 'Alto (cm)'
    - 'Peso (kg)'
    - 'Modelo'
    - 'Variante'
WHERE atributos_dinamicos IS NOT NULL
  AND atributos_dinamicos != '{}'::jsonb
  AND (
      atributos_dinamicos ? 'Código de barras'
   OR atributos_dinamicos ? 'Código de barras (EAN)'
   OR atributos_dinamicos ? 'Categoría'
   OR atributos_dinamicos ? 'Largo (cm)'
   OR atributos_dinamicos ? 'Ancho (cm)'
   OR atributos_dinamicos ? 'Alto (cm)'
   OR atributos_dinamicos ? 'Peso (kg)'
   OR atributos_dinamicos ? 'Modelo'
   OR atributos_dinamicos ? 'Variante'
  );

-- ─── 2. Rellenar articulos.modelo donde está NULL ─────────────────────────────
-- Si el articulo_id parece contener información del modelo (no es solo numérico)
-- y el modelo está vacío, copiar el articulo_id como modelo inicial.
-- Esto permite que el usuario lo corrija después sin perder el dato.

UPDATE articulos
SET modelo = articulo_id
WHERE modelo IS NULL
  AND articulo_id IS NOT NULL
  AND articulo_id ~ '[A-Za-z]'  -- contiene letras (no es un ID puramente numérico)
  AND length(articulo_id) <= 20; -- longitudes razonables de n.º de parte

-- ─── 3. Verificación post-migración ──────────────────────────────────────────

-- Ejecutar para verificar que no quedan duplicados:
-- SELECT id, atributos_dinamicos
-- FROM fichas_tecnicas
-- WHERE atributos_dinamicos ? 'Código de barras'
--    OR atributos_dinamicos ? 'Categoría';

-- Verificar fichas afectadas:
-- SELECT COUNT(*) FROM fichas_tecnicas WHERE modelo IS NOT NULL;
