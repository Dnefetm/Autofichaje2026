-- =============================================================================
-- 03 · MIGRACIÓN DE BLINDAJES
-- =============================================================================
-- Contenido:
--   A. fn_aprobar_precios_draft  → guardia real (precio > 0, estado válido,
--      sync_disabled, envío creíble) + escape manual explícito.
--   B. fn_diagnostico_costo      → dice POR QUÉ no hay costo (nueva, solo lectura).
--   C. Ediciones exactas al motor fn_recalcular_precio_publicacion
--      (motivo en details + estado missing_shipping + piso de punto de equilibrio).
--
-- APPEND-ONLY e idempotente. No borra ni altera tablas.
-- APLICAR: primero en un proyecto de prueba si puedes; luego en producción.
-- =============================================================================

BEGIN;

-- ###########################################################################
-- A · GUARDIA DE APROBACIÓN
-- ###########################################################################
-- Hoy la función escribe el precio del borrador TAL CUAL en la publicación y
-- encola el sync a MeLi, sin mirar si vale 0. Con 5,808 borradores en
-- missing_cost, un clic en "aprobar todos" pone precio 0 en publicaciones vivas.
--
-- p_forzar = true es la salida manual: exige decisión explícita del operador.

DROP FUNCTION IF EXISTS public.fn_aprobar_precios_draft(uuid[]);

CREATE OR REPLACE FUNCTION public.fn_aprobar_precios_draft(
    p_publicaciones UUID[],
    p_forzar        BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp          -- higiene obligatoria en SECURITY DEFINER
AS $body$
DECLARE
    v_id    UUID;
    v_draft RECORD;
BEGIN
    FOR v_id IN SELECT unnest(p_publicaciones) LOOP

        SELECT d.*
          INTO v_draft
          FROM publication_pricing_drafts d
          JOIN publicaciones_externas    p ON p.id = d.publicacion_id
         WHERE d.publicacion_id = v_id
           AND d.pricing_review_status = 'pending'
           AND (
                 p_forzar = true
                 OR (
                      d.draft_price > 0
                  AND d.pricing_status IN ('valid','estimated_params','override_active')
                  AND COALESCE(p.sync_disabled, false) = false
                  AND ( COALESCE(p.free_shipping, false) = false
                        OR COALESCE(p.shipping_cost_monto, 0) > 0 )
                 )
               );

        IF FOUND THEN
            UPDATE publicaciones_externas
               SET sale_price_calculated = v_draft.draft_price,
                   precio_venta          = v_draft.draft_price,
                   base_price            = v_draft.draft_price,
                   pricing_status        = v_draft.pricing_status,
                   last_calc_at          = now(),
                   actualizado_el        = now()
             WHERE id = v_id;

            UPDATE publication_pricing_drafts
               SET pricing_review_status = 'approved', updated_at = now()
             WHERE publicacion_id = v_id;

            INSERT INTO jobs (type, payload, status)
            VALUES ('sync_price', jsonb_build_object('publicacion_id', v_id), 'pending');
        END IF;

        -- Si no entró al IF, el borrador se OMITE en silencio a propósito:
        -- no se toca la publicación y no se encola nada. El motivo se consulta
        -- con fn_diagnostico_costo (abajo) o con la vista de la bandeja.
    END LOOP;
END;
$body$;

REVOKE EXECUTE ON FUNCTION public.fn_aprobar_precios_draft(uuid[], boolean) FROM PUBLIC;


-- ###########################################################################
-- B · DIAGNÓSTICO DEL COSTO (solo lectura)
-- ###########################################################################
-- Convierte "precio 0" en una causa accionable. Respeta la regla del owner:
-- SUGIERE candidatos, NUNCA vincula.

CREATE OR REPLACE FUNCTION public.fn_diagnostico_costo(
    p_articulo_id TEXT,
    p_tipo_costo  TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $f$
DECLARE
    v_alias  RECORD;
    v_tier   TEXT := public.fn_normalizar_tipo_costo(p_tipo_costo);
    v_cand   jsonb;
    v_sku_ok BOOLEAN := false;
    v_prov_ok BOOLEAN := false;
BEGIN
    SELECT * INTO v_alias
      FROM proveedor_articulos_alias a
     WHERE a.articulo_id = p_articulo_id
     ORDER BY a.locked DESC, a.ultima_vez_visto DESC NULLS LAST, a.creado_el DESC
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'motivo_codigo','sin_alias',
            'motivo','El artículo no tiene fila en proveedor_articulos_alias: falta la vinculación manual proveedor→artículo',
            'siguiente_paso','Vincular a mano el artículo con un SKU de la lista del proveedor');
    END IF;

    IF v_alias.modelo_excel IS NULL OR btrim(v_alias.modelo_excel) = '' THEN
        RETURN jsonb_build_object(
            'motivo_codigo','alias_sin_modelo',
            'motivo','El alias existe pero sin modelo_excel (se vinculó solo por código de barras)',
            'proveedor', v_alias.proveedor, 'codigo_excel', v_alias.codigo_excel,
            'siguiente_paso','Completar el modelo_excel del alias a mano');
    END IF;

    -- Candidatos por prefijo del SKU (SUGERENCIA, jamás escritura)
    SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'proveedor',  pp.proveedor,
               'sku',        pp.sku_proveedor,
               'tipo_costo', pp.tipo_costo,
               'valor',      pp.valor))
      INTO v_cand
      FROM precios_proveedor pp
     WHERE pp.vigente
       AND btrim(pp.sku_proveedor) ILIKE btrim(v_alias.modelo_excel) || '%'
     LIMIT 10;

    SELECT EXISTS (SELECT 1 FROM precios_proveedor pp
                    WHERE pp.proveedor = v_alias.proveedor) INTO v_prov_ok;

    IF NOT v_prov_ok THEN
        RETURN jsonb_build_object(
            'motivo_codigo','proveedor_no_coincide',
            'motivo','El nombre del proveedor del alias no existe en precios_proveedor (texto distinto)',
            'proveedor_alias', v_alias.proveedor, 'sku_alias', v_alias.modelo_excel,
            'siguiente_paso','Revisar el nombre exacto del proveedor en la lista importada',
            'candidatos', COALESCE(v_cand,'[]'::jsonb));
    END IF;

    SELECT EXISTS (SELECT 1 FROM precios_proveedor pp
                    WHERE pp.proveedor = v_alias.proveedor
                      AND btrim(pp.sku_proveedor) = btrim(v_alias.modelo_excel)
                      AND pp.vigente) INTO v_sku_ok;

    IF NOT v_sku_ok THEN
        RETURN jsonb_build_object(
            'motivo_codigo','sku_no_vigente',
            'motivo','El SKU del alias no tiene precio vigente en la lista actual del proveedor',
            'proveedor_alias', v_alias.proveedor, 'sku_alias', v_alias.modelo_excel,
            'siguiente_paso','Revisar si el proveedor cambió el código y re-vincular a mano',
            'candidatos', COALESCE(v_cand,'[]'::jsonb));
    END IF;

    RETURN jsonb_build_object(
        'motivo_codigo','tier_sin_coincidencia',
        'motivo','Hay precio vigente pero el tipo_costo no coincide con el cost_basis de la regla',
        'proveedor_alias', v_alias.proveedor, 'sku_alias', v_alias.modelo_excel,
        'tier_pedido_por_la_regla', v_tier,
        'siguiente_paso','Alinear tipo_costo de la lista con cost_basis de la regla',
        'candidatos', COALESCE(v_cand,'[]'::jsonb));
END;
$f$;

REVOKE EXECUTE ON FUNCTION public.fn_diagnostico_costo(text, text) FROM PUBLIC;


-- ###########################################################################
-- C · EDICIONES AL MOTOR (aplicar sobre el archivo de migración, no solo aquí)
-- ###########################################################################
-- El motor vive en supabase/migrations/20260918000001_fn_recalcular_precio_publicacion_canonico.sql
-- Edita ESE archivo con los 5 cambios de abajo y vuelve a ejecutarlo (es CREATE OR REPLACE).
-- Nota: su definición también está (duplicada) en scratch/20260907000001_costo_articulo_canonico.sql.
-- Muévela a supabase/migrations/ para que la BD y el repo dejen de divergir.

-- ── C.1 · Rama 'no_rule' (aprox. línea 56-63) ───────────────────────────────
-- ANTES:  VALUES (p_publicacion_id, 0, 0, 'no_rule', 'pending', '{}'::jsonb, now())
-- DESPUÉS:
--   VALUES (p_publicacion_id, 0, 0, 'no_rule', 'pending',
--           jsonb_build_object('motivo_codigo','sin_regla',
--                              'motivo','No hay regla de pricing activa para esta publicación (marca/categoría/marketplace)'),
--           now())
--   ON CONFLICT (publicacion_id) DO UPDATE SET
--     pricing_status='no_rule', pricing_review_status='pending',
--     details = EXCLUDED.details, updated_at = now();

-- ── C.2 · Rama 'missing_cost' (aprox. línea 78-82) ──────────────────────────
-- ANTES:  ... 'missing_cost', 'pending', '{}'::jsonb, now())
-- DESPUÉS:
--   ... 'missing_cost', 'pending',
--       public.fn_diagnostico_costo(
--         (SELECT m.articulo_id FROM mapeo_publicacion_articulo m
--           WHERE m.publicacion_id = p_publicacion_id
--           ORDER BY m.articulo_id LIMIT 1),
--         v_rule.cost_basis),
--       now())
--   ON CONFLICT (publicacion_id) DO UPDATE SET
--     pricing_status='missing_cost', pricing_review_status='pending',
--     details = EXCLUDED.details, updated_at = now();
-- LÍMITE CONOCIDO: en bundles (varios artículos) se diagnostica el primero.
-- Si quieres el detalle completo, agrega al jsonb un arreglo por artículo.

-- ── C.3 · Rama 'invalid_strategy' (aprox. línea 144-147) ────────────────────
-- DESPUÉS: details = jsonb_build_object('motivo_codigo','estrategia_invalida',
--          'motivo','Comisión + retenciones >= 100%: el denominador es <= 0',
--          'comision_pct', v_commission_pct, 'retenciones_pct', v_withholding_pct)

-- ── C.4 · NUEVO estado 'missing_shipping' ───────────────────────────────────
-- Insertar INMEDIATAMENTE DESPUÉS de calcular v_envio_monto (aprox. línea 113),
-- antes del cálculo del numerador. NO bloquea el precio: lo marca.
--   IF COALESCE(v_pub.free_shipping,false) = true
--      AND COALESCE(v_pub.shipping_cost_monto,0) = 0 THEN
--     v_status := 'missing_shipping';
--     v_reason := v_reason || ' | ENVIO SIN COSTO: item de envio gratis con shipping_cost_monto = 0';
--   END IF;

-- ── C.5 · Piso de punto de equilibrio (protege del redondeo mágico) ─────────
-- El redondeo mágico baja el precio 9-14% por diseño. Con margen 0% eso deja el
-- precio POR DEBAJO del costo. Insertar justo antes del INSERT final:
--   DECLARE v_break_even NUMERIC(12,2);   -- declarar arriba, en el bloque DECLARE
--   v_break_even := (v_costo_base + v_envio_monto) / v_denominador;
--   v_precio_final := GREATEST(v_precio_final, ROUND(v_break_even, 2));
-- Así el redondeo sigue funcionando cuando hay margen sano, y nunca vende a pérdida.

COMMIT;

-- =============================================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =============================================================================
-- 1) La guardia existe y el escape manual funciona:
--    SELECT public.fn_aprobar_precios_draft(ARRAY['<uuid-de-un-draft-en-0>']::uuid[]);
--    → no debe modificar publicaciones_externas ni crear jobs.
--
-- 2) El diagnóstico responde:
--    SELECT public.fn_diagnostico_costo('9f0f314a','menudeo');
--
-- 3) Después de aplicar C, un recálculo debe dejar motivo legible:
--    SELECT public.fn_recalcular_precio_publicacion('<uuid-publicacion>');
--    SELECT pricing_status, details FROM publication_pricing_drafts WHERE publicacion_id='<uuid>';
