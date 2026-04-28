-- 1) Meli Webhook Deduplication Table
CREATE TABLE IF NOT EXISTS meli_webhook_events (
  notification_id text PRIMARY KEY,
  topic text,
  resource text,
  received_at timestamptz DEFAULT now()
);

-- 2) Prevent infinite recursive triggers on pricing updates
CREATE OR REPLACE FUNCTION trg_recalcular_precio_publicacion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN 
    RETURN NEW; 
  END IF;

  IF NEW.sale_price_calculated IS NOT DISTINCT FROM OLD.sale_price_calculated
     AND NEW.pricing_status IS NOT DISTINCT FROM OLD.pricing_status THEN
    RETURN NEW;
  END IF;

  -- We call our V3 logic instead of writing it inline here so we reuse the robust engine.
  -- Notice: we must not call UPDATE publicaciones_externas recursively here.
  -- The trigger fires AFTER UPDATE, but wait, the audit said the trigger makes an UPDATE.
  -- If it's an AFTER UPDATE trigger, calling a function that UPDATEs the same table will recurse.
  -- Instead of fighting the old architecture, we just block the recursion.
  
  PERFORM fn_recalcular_precio_publicacion(NEW.id);
  
  RETURN NEW;
END $$;

-- Drop any existing trigger and recreate
DROP TRIGGER IF EXISTS trg_after_pricing_update ON publicaciones_externas;
-- Wait, the audit didn't say the trigger name, it just said "fn_recalcular_precio_publicacion() se llama desde un trigger AFTER UPDATE OF sale_price_calculated, pricing_status, last_calc_at"
-- Actually we don't know the exact trigger name. I will search for the trigger name.
