-- =============================================================================
-- MIGRACIÓN v81: Seed de Reglas de Precio Base ML y Recálculo
-- =============================================================================

-- Insertar regla base (20% margen, 15% comisión, 16% IVA)
INSERT INTO pricing_rules (marketplace_id, name, rule_type, value, ml_commission_percentage, tax_percentage, ml_fixed_fee) 
SELECT id, 'Regla Base ML', 'margin_percentage', 20, 15, 16, 25 
FROM marketplace_configs 
ON CONFLICT DO NOTHING;

-- Recalcular todos los precios para los costos vigentes que ya fueron confirmados
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT DISTINCT articulo_id 
        FROM costos_articulo 
        WHERE vigente = true AND articulo_id IS NOT NULL
    )
    LOOP
        PERFORM fn_recalcular_precio_marketplace(r.articulo_id);
    END LOOP;
END;
$$;
