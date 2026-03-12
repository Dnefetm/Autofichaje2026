-- Migración V15b: Fixes post-deploy
-- Fecha: 12-mar-2026

-- ============================================================
-- FIX FALLA 4: FK inventory_snapshot → articulos
-- ============================================================
-- PostgREST requiere una FK formal para resolver JOINs embebidos.
-- Sin ella, el query articulos > inventory_snapshot(physical_stock) falla.

-- Primero verificar si la FK ya existe para ser idempotente
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_inventory_snapshot_articulo'
        AND table_name = 'inventory_snapshot'
    ) THEN
        ALTER TABLE inventory_snapshot 
            ADD CONSTRAINT fk_inventory_snapshot_articulo 
            FOREIGN KEY (sku) REFERENCES articulos(articulo_id) ON DELETE CASCADE;
    END IF;
END $$;

-- FK para mapeo_publicacion_articulo.articulo_id → articulos.articulo_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_mapeo_articulo'
        AND table_name = 'mapeo_publicacion_articulo'
    ) THEN
        ALTER TABLE mapeo_publicacion_articulo 
            ADD CONSTRAINT fk_mapeo_articulo 
            FOREIGN KEY (articulo_id) REFERENCES articulos(articulo_id) ON DELETE CASCADE;
    END IF;
END $$;

-- ============================================================
-- FIX FALLA 1: RLS publicaciones_externas — Garantizar lectura total
-- ============================================================
-- Si existe una política restrictiva anterior, eliminarla y recriar abierta

DROP POLICY IF EXISTS "Permitir lectura desde anon" ON publicaciones_externas;
DROP POLICY IF EXISTS "Public read publicaciones" ON publicaciones_externas;
CREATE POLICY "Public read publicaciones" ON publicaciones_externas
    FOR SELECT TO public USING (true);

-- Garantizar que la política de escritura existe
DROP POLICY IF EXISTS "Public write publicaciones" ON publicaciones_externas;
CREATE POLICY "Public write publicaciones" ON publicaciones_externas
    FOR ALL TO public USING (true) WITH CHECK (true);

-- ============================================================
-- FIX FALLA 5: Normalizar campo marketplace en marketplace_configs
-- ============================================================
-- El API route filtra por .in('marketplace', ['meli', 'mercadolibre'])
-- Actualizar valores que no coincidan

UPDATE marketplace_configs 
SET marketplace = 'mercadolibre' 
WHERE marketplace NOT IN ('meli', 'mercadolibre')
  AND marketplace IS NOT NULL;

-- RLS para marketplace_configs (lectura desde API routes con service key, pero por si acaso)
ALTER TABLE marketplace_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read configs v2" ON marketplace_configs;
CREATE POLICY "Public read configs v2" ON marketplace_configs
    FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Public write configs v2" ON marketplace_configs;
CREATE POLICY "Public write configs v2" ON marketplace_configs
    FOR ALL TO public USING (true) WITH CHECK (true);

-- RLS para marketplace_tokens (usado por settings API)
ALTER TABLE marketplace_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read tokens" ON marketplace_tokens;
CREATE POLICY "Public read tokens" ON marketplace_tokens
    FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Public write tokens" ON marketplace_tokens;
CREATE POLICY "Public write tokens" ON marketplace_tokens
    FOR ALL TO public USING (true) WITH CHECK (true);

-- ============================================================
-- Refrescar cache de PostgREST para que detecte las nuevas FKs
-- ============================================================
NOTIFY pgrst, 'reload schema';
