-- Migración V28a — Agregar columna `disponibles` a articulos
-- Propósito: Stock base inicial por artículo (columna G de Sheets "Artículos").
-- Necesario para la fórmula: physical_stock = disponibles + ingresos - egresos
--
-- NOTA: Después de ejecutar este script, correr backfillDisponibles() en Apps Script
-- para poblar los valores reales desde la hoja. Sin el backfill, disponibles = 0
-- y el stock calculado en T6 será incorrecto.

ALTER TABLE articulos
    ADD COLUMN IF NOT EXISTS disponibles INTEGER NOT NULL DEFAULT 0;

-- Verificación post-ejecución:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'articulos' AND column_name = 'disponibles';
