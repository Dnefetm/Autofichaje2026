-- 2026102501: Modificador objetivo a 0 por defecto, soporte de negativos y brecha de urgencia sobre equilibrio matemático exacto

-- 1. Default de redondeo_target_pct a 0.00
ALTER TABLE public.pricing_rule_v3 
  ALTER COLUMN redondeo_target_pct SET DEFAULT 0.00;

-- 2. Actualizar fn_apply_magic_rounding para soportar rango LEAST..GREATEST y target por defecto 0.0
CREATE OR REPLACE FUNCTION public.fn_apply_magic_rounding(
    p_subtotal NUMERIC,
    p_target_pct NUMERIC DEFAULT 0.0,
    p_min_pct NUMERIC DEFAULT -4.0,
    p_max_pct NUMERIC DEFAULT 3.0
) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_ideal_dec NUMERIC;
    v_min_dec NUMERIC;
    v_max_dec NUMERIC;
    v_target_val INT;
    v_min_val INT;
    v_max_val INT;
    v_from_val INT;
    v_to_val INT;
    v_best_num INT;
    v_best_score NUMERIC := -1.0;
    v_best_dist NUMERIC := 999999999;
    v_digit_scores INT[] := ARRAY[4, 10, 7, 6, 8, 5, 3, 9, 1, 2]; -- '0'..'9' mapped to index 1..10
    v_i INT;
    v_s TEXT;
    v_len INT;
    v_c INT;
    v_sum_score NUMERIC;
    v_avg_score NUMERIC;
    v_dist NUMERIC;
    v_digit_val INT;
BEGIN
    IF p_subtotal IS NULL OR p_subtotal <= 1 THEN
        RETURN COALESCE(p_subtotal, 0);
    END IF;

    v_ideal_dec := 1.0 + (COALESCE(p_target_pct, 0.0) / 100.0);
    v_min_dec   := 1.0 - (COALESCE(p_max_pct, 3.0) / 100.0);
    v_max_dec   := 1.0 - (COALESCE(p_min_pct, -4.0) / 100.0);

    v_target_val := ROUND(p_subtotal * v_ideal_dec)::INT;
    v_min_val    := ROUND(p_subtotal * v_min_dec)::INT;
    v_max_val    := ROUND(p_subtotal * v_max_dec)::INT;

    v_from_val   := LEAST(v_min_val, v_max_val);
    v_to_val     := GREATEST(v_min_val, v_max_val);

    v_best_num   := v_target_val;

    FOR v_i IN v_from_val..v_to_val LOOP
        v_s := ABS(v_i)::TEXT;
        v_len := LENGTH(v_s);
        v_sum_score := 0;

        FOR v_c IN 1..v_len LOOP
            v_digit_val := SUBSTRING(v_s FROM v_c FOR 1)::INT;
            v_sum_score := v_sum_score + v_digit_scores[v_digit_val + 1];
        END LOOP;

        v_avg_score := v_sum_score / v_len::NUMERIC;
        v_dist := ABS(v_i - v_target_val);

        IF v_avg_score > v_best_score OR (v_avg_score = v_best_score AND v_dist < v_best_dist) THEN
            v_best_score := v_avg_score;
            v_best_num := v_i;
            v_best_dist := v_dist;
        END IF;
    END LOOP;

    RETURN v_best_num::NUMERIC;
END;
$$;

-- 3. Vista canónica v_urgencia_precios calculada sobre el equilibrio matemático exacto
DROP VIEW IF EXISTS public.v_urgencia_precios CASCADE;

CREATE OR REPLACE VIEW public.v_urgencia_precios AS
SELECT 
    pe.id,
    pe.external_item_id,
    pe.titulo,
    pe.precio_venta,
    pe.original_price,
    pe.seller_custom_field,
    pe.seller_sku,
    pe.brand,
    pe.url_imagen,
    pe.permalink,
    pe.status_externo,
    pe.listing_type_id,
    pe.logistic_type,
    pe.sold_quantity,
    pe.stock_publicado,
    pe.health,
    pe.esta_mapeado,
    pe.ultima_auditoria_precio_el,
    pe.ultima_auditoria_precio_accion,
    d.draft_price,
    d.draft_cost,
    d.pricing_status,
    ROUND(COALESCE((d.details->>'subtotal')::numeric, d.draft_price), 2) AS precio_equilibrio,
    (COALESCE(pe.precio_venta, 0) - ROUND(COALESCE((d.details->>'subtotal')::numeric, d.draft_price), 2)) AS gap_dinero,
    CASE 
        WHEN ROUND(COALESCE((d.details->>'subtotal')::numeric, d.draft_price), 2) > 0 
        THEN ROUND(((COALESCE(pe.precio_venta, 0) - ROUND(COALESCE((d.details->>'subtotal')::numeric, d.draft_price), 2)) / ROUND(COALESCE((d.details->>'subtotal')::numeric, d.draft_price), 2)) * 100)
        ELSE 0 
    END AS gap_pct,
    CASE 
        WHEN COALESCE(pe.precio_venta, 0) <= 0 THEN 'sin_precio'
        WHEN (COALESCE(pe.precio_venta, 0) - ROUND(COALESCE((d.details->>'subtotal')::numeric, d.draft_price), 2)) < 0 THEN 'perdida'
        WHEN (COALESCE(pe.precio_venta, 0) - ROUND(COALESCE((d.details->>'subtotal')::numeric, d.draft_price), 2)) > 0 THEN 'sobreprecio'
        ELSE 'alineado'
    END AS categoria,
    CASE 
        WHEN pe.ultima_auditoria_precio_el IS NULL THEN 'sin_auditar'
        WHEN pe.ultima_auditoria_precio_el < (NOW() - INTERVAL '7 days') THEN 'mas_7_dias'
        ELSE 'auditado'
    END AS estado_auditoria
FROM public.publicaciones_externas pe
JOIN public.publication_pricing_drafts d ON d.publicacion_id = pe.id
WHERE d.draft_price > 0 
  AND d.pricing_status != 'missing_cost'
  AND (pe.external_variation_id IS NULL OR pe.external_variation_id = '' OR pe.external_variation_id = '0');

GRANT SELECT ON public.v_urgencia_precios TO anon, authenticated, service_role;

-- 4. Función de KPIs sobre la vista actualizada
CREATE OR REPLACE FUNCTION public.fn_urgencia_precios_kpis()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
SELECT jsonb_build_object(
    'total', count(*),
    'count_perdida', count(*) FILTER (WHERE categoria = 'perdida'),
    'sum_perdida', COALESCE(sum(abs(gap_dinero)) FILTER (WHERE categoria = 'perdida'), 0),
    'count_sobreprecio', count(*) FILTER (WHERE categoria = 'sobreprecio'),
    'sum_sobreprecio', COALESCE(sum(gap_dinero) FILTER (WHERE categoria = 'sobreprecio'), 0),
    'count_sin_precio', count(*) FILTER (WHERE categoria = 'sin_precio'),
    'count_alineado', count(*) FILTER (WHERE categoria = 'alineado'),
    'count_sin_auditar', count(*) FILTER (WHERE estado_auditoria = 'sin_auditar')
)
FROM public.v_urgencia_precios;
$$;

GRANT EXECUTE ON FUNCTION public.fn_urgencia_precios_kpis() TO anon, authenticated, service_role;
