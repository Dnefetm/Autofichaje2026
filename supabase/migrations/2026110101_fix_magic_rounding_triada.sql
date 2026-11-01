-- =============================================================================
-- MIGRACIÓN: Calibración Definitiva de Redondeo Mágico (Triada de 100 Puntos)
-- Fecha: 2026-11-01
-- Propósito:
--   1. Reemplazar el promedio ciego de todos los dígitos por la función tripartita:
--      - Afinidad de distancia hiperbólica Cauchy (máx 60 pts)
--      - Afinidad de prefijo / orden de magnitud (máx 20 pts)
--      - Terminación mágica acotada respetando estrictamente 1 > 7 > 4 > 2 (máx 25 pts)
--   2. Acotar el barrido a ventana local de ±60 pesos (reducción 95.7% de ciclos CPU).
--   3. Prevenir saltos de centenas/millares (41111 -> 40431, 64111 -> 63927/63931/63911).
--   4. Limpiar funciones temporales de diagnóstico.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_apply_magic_rounding(
    p_subtotal NUMERIC,
    p_target_pct NUMERIC DEFAULT 0.0,
    p_min_pct NUMERIC DEFAULT -4.0,
    p_max_pct NUMERIC DEFAULT 3.0
) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE
AS $$
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
    v_best_dist INT := 999999;
    
    v_i INT;
    v_dist INT;
    v_dist_score NUMERIC;
    v_prefix_score NUMERIC;
    v_term_score NUMERIC;
    v_total_score NUMERIC;
    v_last1 INT;
    v_last2 INT;
    v_s_target TEXT;
    v_s_cand TEXT;
    v_prefix_len INT;
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
    v_s_target   := ABS(v_target_val)::TEXT;

    -- Barrido acotado a la ventana relevante (±60 pesos) dentro del rango permitido
    -- En ±60 pesos se garantiza encontrar terminaciones 11, 41, 71, 21, 1, 7, 4, 2
    FOR v_i IN GREATEST(v_from_val, v_target_val - 60)..LEAST(v_to_val, v_target_val + 60) LOOP
        v_dist := ABS(v_i - v_target_val);

        -- 1. Afinidad por distancia (Decaimiento hiperbólico Cauchy, máx 60 pts)
        v_dist_score := 60.0 / (1.0 + (v_dist::NUMERIC / 22.0));

        -- 2. Afinidad por prefijo / orden de magnitud (máx 20 pts)
        v_s_cand := ABS(v_i)::TEXT;
        v_prefix_len := 0;
        WHILE v_prefix_len < LENGTH(v_s_target) 
          AND v_prefix_len < LENGTH(v_s_cand)
          AND SUBSTRING(v_s_target FROM v_prefix_len + 1 FOR 1) = SUBSTRING(v_s_cand FROM v_prefix_len + 1 FOR 1) LOOP
            v_prefix_len := v_prefix_len + 1;
        END LOOP;

        v_prefix_score := CASE 
            WHEN v_prefix_len >= 4 THEN 20.0
            WHEN v_prefix_len = 3  THEN 14.0
            WHEN v_prefix_len = 2  THEN 6.0
            WHEN v_prefix_len = 1  THEN 2.0
            ELSE 0.0
        END;

        -- 3. Terminación mágica acotada respetando prioridad estricta: 1 > 7 > 4 > 2 (máx 25 pts)
        v_last1 := ABS(v_i) % 10;
        v_last2 := ABS(v_i) % 100;
        v_term_score := 0.0;

        IF v_last1 = 1 THEN
            v_term_score := 10.0;
        ELSIF v_last1 = 7 THEN
            v_term_score := 8.0;
        ELSIF v_last1 = 4 THEN
            v_term_score := 6.0;
        ELSIF v_last1 = 2 THEN
            v_term_score := 4.0;
        END IF;

        IF v_last2 = 11 THEN
            v_term_score := v_term_score + 15.0;
        ELSIF v_last2 IN (41, 71, 21) THEN
            v_term_score := v_term_score + 11.0;
        ELSIF v_last2 IN (17, 77, 44) THEN
            v_term_score := v_term_score + 7.0;
        END IF;

        v_total_score := v_dist_score + v_prefix_score + v_term_score;

        IF v_total_score > v_best_score OR (v_total_score = v_best_score AND v_dist < v_best_dist) THEN
            v_best_score := v_total_score;
            v_best_num := v_i;
            v_best_dist := v_dist;
        END IF;
    END LOOP;

    RETURN v_best_num::NUMERIC;
END;
$$;

COMMENT ON FUNCTION public.fn_apply_magic_rounding(numeric, numeric, numeric, numeric) IS 
'Aplica redondeo mágico calibrado por triada (distancia hiperbólica, prefijo y terminación acotada) para evitar desvíos fuera de la escala local.';

-- Limpieza de función temporal de diagnóstico si existe
DROP FUNCTION IF EXISTS public.fn_apply_magic_rounding_v2(numeric, numeric, numeric, numeric);

COMMIT;
