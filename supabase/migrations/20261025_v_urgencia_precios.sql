-- 20261025: Vista canónica v_urgencia_precios y función fn_urgencia_precios_kpis
-- Permite paginación real en servidor (50 filas) y cálculo instantáneo de KPIs sin transferir miles de filas.

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
    (COALESCE(pe.precio_venta, 0) - d.draft_price) AS gap_dinero,
    CASE 
        WHEN d.draft_price > 0 THEN ROUND(((COALESCE(pe.precio_venta, 0) - d.draft_price) / d.draft_price) * 100)
        ELSE 0 
    END AS gap_pct,
    CASE 
        WHEN COALESCE(pe.precio_venta, 0) <= 0 THEN 'sin_precio'
        WHEN (COALESCE(pe.precio_venta, 0) - d.draft_price) < 0 THEN 'perdida'
        WHEN (COALESCE(pe.precio_venta, 0) - d.draft_price) > 0 THEN 'sobreprecio'
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
