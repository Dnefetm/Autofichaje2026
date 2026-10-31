-- =============================================================================
-- MIGRACIÓN: Deduplicación canónica en v_urgencia_precios priorizando tradicional
-- Fecha: 2026-10-31
-- Propósito:
--   1. Ocultar publicaciones de catálogo cuando existe su par tradicional activa.
--   2. Si no existe tradicional (catálogo huérfano), la de catálogo sí se muestra.
--   3. Proyectar tipo_publicacion, par_item_id, id_producto_catalogo.
--   4. Actualizar fn_aprobar_precios_draft con aprobación en espejo:
--      - Aprueba la tradicional y encola sync_price para MeLi.
--      - Resuelve pares de catálogo y los aprueba en BD sin encolar sync_price redundante.
-- =============================================================================

BEGIN;

-- 1. Actualización de la vista v_urgencia_precios
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
    round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2) AS precio_equilibrio,
    COALESCE(pe.precio_venta, 0::numeric) - round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2) AS gap_dinero,
    CASE
        WHEN round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2) > 0::numeric THEN
            round((COALESCE(pe.precio_venta, 0::numeric) - round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2)) / round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2) * 100::numeric)
        ELSE 0::numeric
    END AS gap_pct,
    CASE
        WHEN COALESCE(pe.precio_venta, 0::numeric) <= 0::numeric THEN 'sin_precio'::text
        WHEN (COALESCE(pe.precio_venta, 0::numeric) - round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2)) < 0::numeric THEN 'perdida'::text
        WHEN (COALESCE(pe.precio_venta, 0::numeric) - round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2)) > 0::numeric THEN 'sobreprecio'::text
        ELSE 'alineado'::text
    END AS categoria,
    CASE
        WHEN pe.ultima_auditoria_precio_el IS NULL THEN 'sin_auditar'::text
        WHEN pe.ultima_auditoria_precio_el < (now() - '7 days'::interval) THEN 'mas_7_dias'::text
        ELSE 'auditado'::text
    END AS estado_auditoria,
    pe.tipo_publicacion,
    pe.par_item_id,
    pe.id_producto_catalogo
FROM public.publicaciones_externas pe
JOIN public.publication_pricing_drafts d ON d.publicacion_id = pe.id
WHERE d.draft_price > 0::numeric
  AND d.pricing_status <> 'missing_cost'::text
  AND (pe.external_variation_id IS NULL OR pe.external_variation_id = ''::text OR pe.external_variation_id = '0'::text)
  AND pe.status_externo <> 'closed'::text
  AND NOT ('deleted'::text = ANY (COALESCE(pe.sub_status, '{}'::text[])))
  AND NOT (('private'::text = ANY (COALESCE(pe.channels, '{}'::text[]))) AND NOT ('marketplace'::text = ANY (COALESCE(pe.channels, '{}'::text[]))))
  AND NOT (pe.status_externo = 'paused'::text AND COALESCE(pe.precio_venta, 0::numeric) <= 0::numeric)
  -- Deduplicación visual: Ocultar publicación de catálogo si existe su par tradicional activa
  AND NOT (
      pe.tipo_publicacion IN ('catalogo', 'catalogo_derivada')
      AND (
          (pe.par_item_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.publicaciones_externas trad
              WHERE trad.external_item_id = pe.par_item_id
                AND trad.tipo_publicacion = 'tradicional'
                AND trad.status_externo != 'closed'
          ))
          OR (pe.par_item_id IS NULL AND pe.id_producto_catalogo IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.publicaciones_externas trad
              WHERE trad.id_producto_catalogo = pe.id_producto_catalogo
                AND trad.marketplace_id = pe.marketplace_id
                AND trad.tipo_publicacion = 'tradicional'
                AND trad.status_externo != 'closed'
          ))
      )
  );

COMMENT ON VIEW public.v_urgencia_precios IS 'Vista de urgencia de precios deduplicada: prioriza publicaciones tradicionales y oculta publicaciones de catálogo redundantes.';

-- 2. Actualización de fn_aprobar_precios_draft con aprobación en espejo de pares
CREATE OR REPLACE FUNCTION public.fn_aprobar_precios_draft(
    p_publicaciones UUID[],
    p_forzar        BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $body$
DECLARE
    v_id            UUID;
    v_draft         RECORD;
    v_cat_record    RECORD;
BEGIN
    FOR v_id IN SELECT unnest(p_publicaciones) LOOP

        SELECT d.*, p.external_item_id, p.id_producto_catalogo, p.marketplace_id, p.tipo_publicacion
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
            -- A. Actualizar publicación principal (tradicional o huérfana)
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

            -- Encolar sync_price a MeLi para la publicación principal
            INSERT INTO jobs (type, payload, status)
            VALUES ('sync_price', jsonb_build_object('publicacion_id', v_id), 'pending');

            -- B. Si la publicación principal es tradicional, aprobar en espejo sus pares de catálogo en BD
            IF v_draft.tipo_publicacion = 'tradicional' THEN
                FOR v_cat_record IN
                    SELECT cd.publicacion_id, cd.draft_price, cd.pricing_status
                      FROM publicaciones_externas cat
                      JOIN publication_pricing_drafts cd ON cd.publicacion_id = cat.id
                     WHERE (
                             (cat.par_item_id IS NOT NULL AND cat.par_item_id = v_draft.external_item_id)
                             OR (cat.par_item_id IS NULL AND cat.id_producto_catalogo IS NOT NULL AND cat.id_producto_catalogo = v_draft.id_producto_catalogo AND cat.marketplace_id = v_draft.marketplace_id)
                           )
                       AND cat.tipo_publicacion IN ('catalogo', 'catalogo_derivada')
                       AND cat.status_externo != 'closed'
                       AND cd.pricing_review_status = 'pending'
                LOOP
                    -- Marcar catálogo como approved en BD para evitar borradores huérfanos
                    UPDATE publicaciones_externas
                       SET sale_price_calculated = v_cat_record.draft_price,
                           precio_venta          = v_cat_record.draft_price,
                           base_price            = v_cat_record.draft_price,
                           pricing_status        = v_cat_record.pricing_status,
                           last_calc_at          = now(),
                           actualizado_el        = now()
                     WHERE id = v_cat_record.publicacion_id;

                    UPDATE publication_pricing_drafts
                       SET pricing_review_status = 'approved', updated_at = now()
                     WHERE publicacion_id = v_cat_record.publicacion_id;

                    -- NOTA ARQUITECTÓNICA: NO se inserta job 'sync_price' para el catálogo.
                    -- MeLi sincroniza el catálogo nativamente en <2s al recibir el precio de la tradicional.
                END LOOP;
            END IF;
        END IF;

    END LOOP;
END;
$body$;

REVOKE EXECUTE ON FUNCTION public.fn_aprobar_precios_draft(uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_aprobar_precios_draft(uuid[], boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_aprobar_precios_draft(uuid[], boolean) TO authenticated;

COMMIT;
