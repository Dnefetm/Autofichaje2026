-- =============================================================================
-- MIGRACIÓN (append-only) — Proveedores como entidad (crear/archivar)
-- =============================================================================
-- Crea la tabla maestra de proveedores (hoy el "proveedor" es solo texto suelto en
-- varias tablas). Permite archivar (ocultar) sin borrar datos.
--
-- Seguro e idempotente: CREATE TABLE IF NOT EXISTS + backfill ON CONFLICT DO NOTHING.
-- NO se implementa "renombrar" aquí (renombrar implica cascada sobre 5+ tablas y es
-- de riesgo alto; se hará aparte con su propia validación).
-- No toca datos existentes (solo crea la tabla y la rellena con nombres ya presentes).
-- =============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.proveedores (
    nombre        text PRIMARY KEY,
    archivado     boolean NOT NULL DEFAULT false,
    creado_el     timestamptz NOT NULL DEFAULT now(),
    actualizado_el timestamptz NOT NULL DEFAULT now()
);

-- Backfill: nombres de proveedores ya existentes (no duplica, no borra nada)
INSERT INTO public.proveedores (nombre)
SELECT DISTINCT proveedor
FROM public.listas_precios_proveedor
WHERE proveedor IS NOT NULL AND proveedor <> ''
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO public.proveedores (nombre)
SELECT DISTINCT proveedor
FROM public.importaciones_excel
WHERE proveedor IS NOT NULL AND proveedor <> ''
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO public.proveedores (nombre)
SELECT DISTINCT proveedor
FROM public.proveedor_articulos_alias
WHERE proveedor IS NOT NULL AND proveedor <> ''
ON CONFLICT (nombre) DO NOTHING;

COMMIT;

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.proveedores;
