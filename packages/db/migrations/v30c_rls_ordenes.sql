-- v30c_rls_ordenes.sql — RLS para tablas de órdenes
-- Sin RLS habilitado, las queries del cliente frontend son bloqueadas silenciosamente.
-- Se habilita RLS y se crean políticas de lectura para el rol 'authenticated'.

-- ══════════════════════════════════════════════════════════════════════
-- ordenes
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE ordenes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ordenes_read" ON ordenes;
CREATE POLICY "ordenes_read"
    ON ordenes FOR SELECT
    TO authenticated
    USING (true);

-- ══════════════════════════════════════════════════════════════════════
-- orden_items
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE orden_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orden_items_read" ON orden_items;
CREATE POLICY "orden_items_read"
    ON orden_items FOR SELECT
    TO authenticated
    USING (true);

-- ══════════════════════════════════════════════════════════════════════
-- reservaciones_stock
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE reservaciones_stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservaciones_stock_read" ON reservaciones_stock;
CREATE POLICY "reservaciones_stock_read"
    ON reservaciones_stock FOR SELECT
    TO authenticated
    USING (true);

-- ══════════════════════════════════════════════════════════════════════
-- system_alerts — ya existente, por si tampoco tenía RLS
-- ══════════════════════════════════════════════════════════════════════
ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_alerts_read" ON system_alerts;
CREATE POLICY "system_alerts_read"
    ON system_alerts FOR SELECT
    TO authenticated
    USING (true);

-- ══════════════════════════════════════════════════════════════════════
-- VERIFICACIÓN
-- ══════════════════════════════════════════════════════════════════════
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE tablename IN ('ordenes','orden_items','reservaciones_stock','system_alerts');
-- Todas deben mostrar rowsecurity = true
