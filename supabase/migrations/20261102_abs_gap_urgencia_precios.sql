-- Agrega columnas de magnitud absoluta a v_urgencia_precios para ordenar por
-- "mayor desviación" sin que el signo (pérdida vs sobreprecio) invierta el orden.
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
        WHEN round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2) > 0::numeric THEN round((COALESCE(pe.precio_venta, 0::numeric) - round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2)) / round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2) * 100::numeric)
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
    pe.id_producto_catalogo,
    ABS(COALESCE(pe.precio_venta, 0::numeric) - round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2)) AS abs_gap_dinero,
    ABS(
        CASE
            WHEN round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2) > 0::numeric THEN round((COALESCE(pe.precio_venta, 0::numeric) - round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2)) / round(COALESCE((d.details ->> 'subtotal'::text)::numeric, d.draft_price), 2) * 100::numeric)
            ELSE 0::numeric
        END
    ) AS abs_gap_pct
FROM publicaciones_externas pe
    JOIN publication_pricing_drafts d ON d.publicacion_id = pe.id
WHERE d.draft_price > 0::numeric
    AND d.pricing_status <> 'missing_cost'::text
    AND (pe.external_variation_id IS NULL OR pe.external_variation_id = ''::text OR pe.external_variation_id = '0'::text)
    AND pe.status_externo <> 'closed'::text
    AND NOT ('deleted'::text = ANY (COALESCE(pe.sub_status, '{}'::text[])))
    AND NOT (('private'::text = ANY (COALESCE(pe.channels, '{}'::text[]))) AND NOT ('marketplace'::text = ANY (COALESCE(pe.channels, '{}'::text[]))))
    AND NOT (pe.status_externo = 'paused'::text AND COALESCE(pe.precio_venta, 0::numeric) <= 0::numeric)
    AND NOT ((pe.tipo_publicacion = ANY (ARRAY['catalogo'::text, 'catalogo_derivada'::text])) AND (pe.par_item_id IS NOT NULL AND (EXISTS ( SELECT 1
               FROM publicaciones_externas trad
              WHERE trad.external_item_id = pe.par_item_id AND trad.tipo_publicacion = 'tradicional'::text AND trad.status_externo <> 'closed'::text)) OR pe.par_item_id IS NULL AND pe.id_producto_catalogo IS NOT NULL AND (EXISTS ( SELECT 1
               FROM publicaciones_externas trad
              WHERE trad.id_producto_catalogo = pe.id_producto_catalogo AND trad.marketplace_id = pe.marketplace_id AND trad.tipo_publicacion = 'tradicional'::text AND trad.status_externo <> 'closed'::text))));
