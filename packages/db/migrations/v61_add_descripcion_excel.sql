-- v61: Add descripcion_excel column to costos_articulo
-- Stores the product description/title from the supplier Excel
-- for side-by-side comparison in the review step.

ALTER TABLE costos_articulo ADD COLUMN IF NOT EXISTS descripcion_excel text;
