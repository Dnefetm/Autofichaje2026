-- Migración V27a — Trigger protector para articulos.sku
-- Propósito: Mientras existan FKs apuntando a articulos(sku), este trigger
-- garantiza que cualquier INSERT en articulos siempre tenga sku poblado.
-- Se elimina en Fase 5 (despoblar sku), una vez que ninguna FK lo apunte.
--
-- Ejecutar en Supabase SQL Editor ANTES de v27b_fix_fks.sql
-- Reversión: DROP TRIGGER + DROP FUNCTION (ver al final del archivo)

CREATE OR REPLACE FUNCTION fn_sync_sku_from_articulo_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.sku IS NULL THEN
        NEW.sku := NEW.articulo_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sku_before_insert ON articulos;

CREATE TRIGGER trg_sync_sku_before_insert
    BEFORE INSERT ON articulos
    FOR EACH ROW EXECUTE FUNCTION fn_sync_sku_from_articulo_id();

-- Verificación post-ejecución (debe mostrar el trigger):
-- SELECT trigger_name, event_manipulation, action_timing
-- FROM information_schema.triggers
-- WHERE event_object_table = 'articulos';

-- ── REVERSIÓN ──────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_sync_sku_before_insert ON articulos;
-- DROP FUNCTION IF EXISTS fn_sync_sku_from_articulo_id();
