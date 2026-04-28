import { NextResponse } from 'next/server';
import { Client } from 'pg';
import fs from 'fs';
import path from 'path';

export async function GET() {
  const uri = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  
  if (!uri) {
    return NextResponse.json({ error: "No DB connection string found in Vercel env vars." }, { status: 500 });
  }

  const client = new Client({ connectionString: uri });

  try {
    await client.connect();
    
    // The SQL to fix the 4 functions
    const sql = \`
BEGIN;

-- 1. Función de recálculo (CORREGIDA la columna sku_articulo -> articulo_id)
CREATE OR REPLACE FUNCTION public.fn_recalcular_precio_publicacion(p_publicacion_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_pub RECORD;
    v_costo_base NUMERIC(12,2);
    v_override RECORD;
    v_commission RECORD;
    v_rule RECORD;
    v_precio_final NUMERIC(12,2);
    v_old_price NUMERIC(12,2);
    v_status TEXT := 'valid';
    v_reason TEXT := 'Cálculo exitoso';
    v_margen_percent NUMERIC(5,2);
BEGIN
    SELECT * INTO v_pub FROM publicaciones_externas WHERE id = p_publicacion_id;
    IF NOT FOUND THEN RETURN; END IF;
    v_old_price := v_pub.sale_price_calculated;

    SELECT * INTO v_override FROM publication_pricing_overrides 
    WHERE publicacion_id = p_publicacion_id AND (valido_hasta IS NULL OR valido_hasta > now());

    IF FOUND AND v_override.override_type = 'fixed_price' THEN
        UPDATE publicaciones_externas SET sale_price_calculated = v_override.value, pricing_status = 'override_active', last_calc_at = now() WHERE id = p_publicacion_id;
        INSERT INTO publication_pricing_history (publicacion_id, old_price, new_price, status, reason) VALUES (p_publicacion_id, v_old_price, v_override.value, 'override_active', 'Precio fijo manual');
        RETURN;
    END IF;

    -- AQUI ESTABA EL BUG: m.sku_articulo fue renombrado a m.articulo_id en la V15
    SELECT SUM(c.valor * m.cantidad_requerida) INTO v_costo_base
    FROM mapeo_publicacion_articulo m
    JOIN costos_articulo c ON c.articulo_id = m.articulo_id AND c.vigente = true AND c.valor > 0
    WHERE m.publicacion_id = p_publicacion_id;

    IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
        UPDATE publicaciones_externas SET pricing_status = 'error_no_cost', last_calc_at = now() WHERE id = p_publicacion_id;
        RETURN;
    END IF;

    SELECT * INTO v_commission FROM meli_category_commissions 
    WHERE marketplace_id = v_pub.marketplace_id AND category_id = v_pub.category_id AND is_current = true;

    DECLARE
        v_com_pct NUMERIC(5,2) := COALESCE(v_commission.commission_percentage, 15.00);
        v_com_fee NUMERIC(10,2) := CASE WHEN v_costo_base < 299 THEN 25.00 ELSE 0 END;
    BEGIN
        SELECT * INTO v_rule FROM pricing_rules WHERE marketplace_id = v_pub.marketplace_id AND is_active = true LIMIT 1;
        
        IF FOUND AND v_override.override_type = 'custom_margin' THEN
            v_margen_percent := v_override.value;
            v_reason := 'Margen custom manual';
        ELSIF FOUND AND v_rule.rule_type = 'margin_percentage' THEN
            v_margen_percent := v_rule.value;
            v_reason := 'Regla global de margen aplicada';
        ELSE
            v_margen_percent := 20.00;
        END IF;

        DECLARE
            v_subtotal NUMERIC(12,2) := (v_costo_base * 1.16) + COALESCE(v_rule.shipping_cost, 0) + v_com_fee;
        BEGIN
            IF (v_com_pct + v_margen_percent) >= 100 THEN
                v_status := 'error_negative_margin';
                v_precio_final := v_subtotal * 1.5; 
                v_reason := 'Suma de margen y comisión supera 100%';
            ELSE
                v_precio_final := v_subtotal / (1.0 - ((v_com_pct + v_margen_percent) / 100.0));
            END IF;

            v_precio_final := ROUND(v_precio_final, 2);

            UPDATE publicaciones_externas SET sale_price_calculated = v_precio_final, pricing_status = v_status, last_calc_at = now() WHERE id = p_publicacion_id;
            INSERT INTO publication_pricing_history (publicacion_id, old_price, new_price, status, reason) VALUES (p_publicacion_id, v_old_price, v_precio_final, v_status, v_reason);
        END;
    END;
END;
$$;

-- 2. Trigger de Costos (CORREGIDO m.sku_articulo -> m.articulo_id)
CREATE OR REPLACE FUNCTION public.trg_costos_articulo_recalcular_async()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.articulo_id IS NOT NULL AND NEW.vigente = true THEN
        INSERT INTO jobs (type, payload, status)
        SELECT 'recalc_pricing_bundle', jsonb_build_object('publicacion_id', m.publicacion_id), 'pending'
        FROM mapeo_publicacion_articulo m
        WHERE m.articulo_id = NEW.articulo_id
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

-- 3. Trigger de Mapeo
CREATE OR REPLACE FUNCTION public.trg_mapeo_publicacion_recalcular_async()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO jobs (type, payload, status) VALUES ('recalc_pricing_bundle', jsonb_build_object('publicacion_id', OLD.publicacion_id), 'pending');
        RETURN OLD;
    ELSE
        INSERT INTO jobs (type, payload, status) VALUES ('recalc_pricing_bundle', jsonb_build_object('publicacion_id', NEW.publicacion_id), 'pending');
        RETURN NEW;
    END IF;
END;
$$;

DROP TRIGGER IF EXISTS trigger_recalcular_precios_mapeo ON mapeo_publicacion_articulo;
CREATE TRIGGER trigger_recalcular_precios_mapeo
    AFTER INSERT OR UPDATE OF cantidad_requerida, articulo_id OR DELETE
    ON mapeo_publicacion_articulo
    FOR EACH ROW
    EXECUTE FUNCTION trg_mapeo_publicacion_recalcular_async();

COMMIT;
`;

    await client.query(sql);
    await client.end();
    
    return NextResponse.json({ ok: true, message: "Funciones parcheadas exitosamente!" });
  } catch (err: any) {
    await client.end().catch(()=>null);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
