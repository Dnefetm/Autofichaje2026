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

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_recalcular_precio_publicacion ON publicaciones_externas;
CREATE TRIGGER trg_recalcular_precio_publicacion
AFTER UPDATE OF sale_price_calculated, pricing_status, last_calc_at ON publicaciones_externas
FOR EACH ROW EXECUTE FUNCTION trg_recalcular_precio_publicacion();

-- 3) Índice de reglas
CREATE INDEX IF NOT EXISTS ix_pricing_rules_lookup
  ON pricing_rule_v3 (is_active, priority DESC);
