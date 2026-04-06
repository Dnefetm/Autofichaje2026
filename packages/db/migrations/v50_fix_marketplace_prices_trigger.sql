-- =============================================================================
-- MIGRACIÓN v50: Corregir trigger en marketplace_prices (NEW.sku → NEW.articulo_id)
-- =============================================================================
-- CONTEXTO:
--   La columna marketplace_prices.sku fue renombrada a articulo_id en v47.
--   Si existía un trigger manual en Supabase que referenciaba NEW.sku,
--   cualquier INSERT/UPDATE en marketplace_prices falla con:
--     "record new has no field sku"
--
-- IMPORTANT: Se usa un nombre de función DISTINTO (fn_encolar_sync_price_marketplace)
--   para NO sobreescribir fn_encolar_sync_price() que v44 usa para publicaciones_externas.
--   Sobreescribirla rompería el trigger de sync de precio de publicaciones a MeLi.
--
-- El payload del job retiene la key 'sku' (como string del JSON) por compatibilidad
--   con el worker, pero lee el valor correcto de NEW.articulo_id.
-- =============================================================================

-- ─── Función separada para marketplace_prices ──────────────────────────────

CREATE OR REPLACE FUNCTION fn_encolar_sync_price_marketplace()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO jobs (type, payload, status, scheduled_at, created_at)
  VALUES (
    'sync_price',
    jsonb_build_object(
      'sku',            NEW.articulo_id,
      'marketplace_id', NEW.marketplace_id,
      'sale_price',     NEW.sale_price
    ),
    'pending',
    NOW(),
    NOW()
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- ─── Limpiar cualquier trigger viejo con NEW.sku ───────────────────────────

-- Eliminar el trigger viejo que usaba NEW.sku — puede tener cualquiera de estos nombres:
DROP TRIGGER IF EXISTS trg_encolar_sync_price ON marketplace_prices;
DROP TRIGGER IF EXISTS trg_sync_price_marketplace ON marketplace_prices;
DROP TRIGGER IF EXISTS trg_sync_price_marketplace_prices ON marketplace_prices;

-- ─── Crear trigger correcto ───────────────────────────────────────────────

CREATE TRIGGER trg_sync_price_marketplace_prices
    AFTER INSERT OR UPDATE OF sale_price
    ON marketplace_prices
    FOR EACH ROW
    EXECUTE FUNCTION fn_encolar_sync_price_marketplace();

-- ─── Verificación post-aplicación ─────────────────────────────────────────

-- Confirmar triggers activos en ambas tablas:
-- SELECT tgname, tgrelid::regclass AS tabla, tgenabled
-- FROM pg_trigger
-- WHERE tgname IN ('trg_encolar_sync_price', 'trg_sync_price_marketplace_prices');

-- Confirmar que fn_encolar_sync_price (v44) sigue intacta:
-- SELECT proname, prosrc FROM pg_proc WHERE proname = 'fn_encolar_sync_price';

-- Test: guardar un precio y verificar que no falla:
-- UPDATE marketplace_prices SET sale_price = sale_price WHERE articulo_id = '<uuid>' LIMIT 1;
