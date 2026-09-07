-- ====================================================================
-- SCRIPT DE VERIFICACION POST-MIGRACION
-- ====================================================================

-- 1. Validar que egresos.tipo_egreso acepte 'venta_subdistribuidor'
SELECT '1. TIPO EGRESO' as check, 
       EXISTS (
         SELECT 1 FROM pg_constraint 
         WHERE conrelid = 'egresos'::regclass 
           AND consrc ILIKE '%venta_subdistribuidor%'
       ) as tiene_venta_subdistribuidor_en_check;

-- 2. Validar que el trigger de sync a MeLi se dispare por change de reserved_stock
SELECT '2. TRIGGER SYNC' as check,
       tgname as trigger_name,
       tgtype::int::bit(7) as trigger_type,
       pg_get_triggerdef(oid) as definicion
FROM pg_trigger
WHERE tgrelid = 'inventory_snapshot'::regclass
  AND tgname ILIKE '%sync%' OR tgname ILIKE '%meli%';

-- 3. Validar reservaciones_stock (que tenga origen, orden_item_id y pedido_item_id)
SELECT '3. RESERVACIONES_STOCK COLUMNAS' as check,
       column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'reservaciones_stock'
  AND column_name IN ('origen', 'orden_item_id', 'pedido_item_id');

-- 4. Validar UNIQUE en clientes.nombre
SELECT '4. CLIENTES UNIQUE' as check,
       indexname, indexdef
FROM pg_indexes
WHERE tablename = 'clientes' AND indexname = 'uq_clientes_nombre_lower';
