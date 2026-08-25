-- =============================================================================
-- MIGRACION v79: Consolidacion de tablas creadas FUERA DE BANDA (2026-08-25)
-- =============================================================================
-- Contexto (ver docs/diagnostico_blueprint_2026-08-23.md, hallazgo H2):
-- Estas tablas existen en produccion pero fueron creadas fuera de
-- supabase/migrations/ (via packages/db/ o SQL directo), lo que generaba
-- falsos TABLE_NOT_FOUND en el blueprint y deuda de esquema.
-- Esta migracion las registra en la fuente oficial. Es IDEMPOTENTE
-- (IF NOT EXISTS): en produccion no cambia nada; en ambientes nuevos las crea.
--
-- PENDIENTE (no se consolidan por no tener definicion en el repo):
--   - public.importaciones_precios  (usada en api/precios/[proveedor]/aplicar)
--   - public."documentos-fuente"    (usada en api/autoficha, nombre con guion)
-- Antes de consolidarlas, exportar su DDL real desde produccion:
--   pg_dump --schema-only --table=public.importaciones_precios ...
-- NO inventar el esquema.
-- =============================================================================

-- 1. Batches de importacion de precios (definicion: packages/db/migrations/v62)
CREATE TABLE IF NOT EXISTS precio_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    importacion_excel_id UUID NOT NULL REFERENCES importaciones_excel(id) ON DELETE CASCADE,
    usuario TEXT NOT NULL,
    archivo TEXT,
    filas_afectadas INTEGER DEFAULT 0,
    estado TEXT DEFAULT 'completado',
    creado_el TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE precio_import_batches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Lectura pública para autenticados" ON precio_import_batches FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admin insert/delete/update" ON precio_import_batches AS PERMISSIVE FOR ALL USING (
    (auth.jwt() ->> 'role') = 'admin' OR current_setting('role', true) = 'service_role'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Historico de precios del proveedor (definicion: packages/db/migrations/v62)
CREATE TABLE IF NOT EXISTS precios_historial_proveedor (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES precio_import_batches(id) ON DELETE CASCADE,
    costo_articulo_id UUID REFERENCES costos_articulo(id) ON DELETE SET NULL,
    articulo_id TEXT NOT NULL REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    tipo_costo TEXT NOT NULL,
    valor_antiguo NUMERIC(12,2),
    valor_nuevo NUMERIC(12,2) NOT NULL,
    moneda TEXT DEFAULT 'MXN',
    creado_el TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uq_historial_costo UNIQUE (batch_id, costo_articulo_id)
);

ALTER TABLE precios_historial_proveedor ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Lectura pública para autenticados" ON precios_historial_proveedor FOR SELECT USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admin insert/delete/update" ON precios_historial_proveedor AS PERMISSIVE FOR ALL USING (
    (auth.jwt() ->> 'role') = 'admin' OR current_setting('role', true) = 'service_role'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Componentes de bundles/kits (definicion: packages/db/schema.sql)
CREATE TABLE IF NOT EXISTS bundle_components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_sku TEXT REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    component_sku TEXT REFERENCES articulos(articulo_id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1,
    UNIQUE(bundle_sku, component_sku)
);
