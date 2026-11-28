-- Migración Fases 3-5: Replicación multi-cuenta (RPC asimétrica + tablas de lote + RLS + Gate DDL)

-- 1. Índices parciales de soporte para detección asimétrica Origen -> Destino
CREATE INDEX IF NOT EXISTS idx_pub_ext_replicar_src
    ON public.publicaciones_externas (marketplace_id, status_externo, tipo_publicacion)
    WHERE external_variation_id = '0' AND status_externo <> 'closed';

CREATE INDEX IF NOT EXISTS idx_pub_ext_replicar_sku
    ON public.publicaciones_externas (marketplace_id, seller_sku)
    WHERE seller_sku IS NOT NULL AND status_externo IN ('active', 'paused', 'under_review');

CREATE INDEX IF NOT EXISTS idx_pub_ext_replicar_gtin
    ON public.publicaciones_externas (marketplace_id, gtin)
    WHERE gtin IS NOT NULL AND status_externo IN ('active', 'paused', 'under_review');

CREATE INDEX IF NOT EXISTS idx_pub_ext_dst_cov
    ON public.publicaciones_externas (marketplace_id, id)
    INCLUDE (seller_sku, seller_custom_field, gtin)
    WHERE status_externo IN ('active', 'paused', 'under_review');

CREATE INDEX IF NOT EXISTS idx_pub_ext_cat_child_cov
    ON public.publicaciones_externas (marketplace_id, par_item_id, status_externo)
    INCLUDE (id_producto_catalogo)
    WHERE par_item_id IS NOT NULL AND id_producto_catalogo IS NOT NULL AND status_externo <> 'closed';

CREATE INDEX IF NOT EXISTS idx_pub_ext_vars_cov
    ON public.publicaciones_externas (marketplace_id, external_item_id)
    WHERE external_variation_id <> '0' AND status_externo <> 'closed';

CREATE INDEX IF NOT EXISTS idx_mapeo_pub_created_cov
    ON public.mapeo_publicacion_articulo (publicacion_id, created_at ASC)
    INCLUDE (articulo_id, cantidad_requerida);

-- 2. Tabla de lotes de replicación (con RLS estricto)
CREATE TABLE IF NOT EXISTS public.replication_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_marketplace_id UUID NOT NULL REFERENCES public.marketplace_configs(id),
    target_marketplace_id UUID NOT NULL REFERENCES public.marketplace_configs(id),
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'paused', 'paused_auth_error', 'completed', 'cancelled', 'rolled_back')),
    total_items INTEGER NOT NULL DEFAULT 0,
    completed_count INTEGER NOT NULL DEFAULT 0,
    waiting_optin_count INTEGER NOT NULL DEFAULT 0,
    linked_existing_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    policies JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_replication_batches_created
    ON public.replication_batches (created_at DESC);

ALTER TABLE public.replication_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.replication_batches FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.replication_batches TO service_role;

-- 3. Tabla de ítems por lote de replicación (con RLS estricto + idempotencia)
CREATE TABLE IF NOT EXISTS public.replication_batch_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.replication_batches(id) ON DELETE CASCADE,
    source_publicacion_id UUID NOT NULL REFERENCES public.publicaciones_externas(id),
    source_item_id TEXT NOT NULL,
    source_title TEXT,
    articulo_id TEXT,
    cantidad_requerida INTEGER NOT NULL DEFAULT 1,
    target_marketplace_id UUID NOT NULL REFERENCES public.marketplace_configs(id),
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'processing',
            'completed',
            'waiting_optin',
            'optin_failed',
            'linked_existing',
            'failed_validation',
            'failed_error',
            'skipped',
            'cancelled',
            'paused_rollback',
            'rolled_back'
        )),
    job_id UUID,
    target_publicacion_id UUID,
    target_item_id TEXT,
    target_catalog_item_id TEXT,
    applied_price NUMERIC,
    applied_title TEXT,
    error_code TEXT,
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (batch_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_rep_batch_items_batch
    ON public.replication_batch_items (batch_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_rep_batch_items_target_item
    ON public.replication_batch_items (target_item_id)
    WHERE target_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rep_batch_items_target_idemp
    ON public.replication_batch_items (target_marketplace_id, idempotency_key);

ALTER TABLE public.replication_batch_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.replication_batch_items FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.replication_batch_items TO service_role;

-- 4. RPC set-based optimizada para consultar publicaciones activas de Origen ausentes en Destino
-- Calcula cat_child, vars, articulos e inventory_snapshot unicamente sobre el slice paginado (<= 200 filas).
CREATE OR REPLACE FUNCTION public.fn_publicaciones_pendientes_replicar(
    p_source_marketplace_id UUID,
    p_target_marketplace_id UUID,
    p_search TEXT DEFAULT NULL,
    p_brand TEXT DEFAULT NULL,
    p_category_id TEXT DEFAULT NULL,
    p_catalog_filter TEXT DEFAULT 'all',
    p_mapped_filter TEXT DEFAULT 'all',
    p_stock_filter TEXT DEFAULT 'all',
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    publicacion_id UUID,
    external_item_id TEXT,
    titulo TEXT,
    url_imagen TEXT,
    permalink TEXT,
    precio_venta NUMERIC,
    stock_publicado INTEGER,
    status_externo TEXT,
    listing_type_id TEXT,
    category_id TEXT,
    domain_id TEXT,
    logistic_type TEXT,
    free_shipping BOOLEAN,
    seller_sku TEXT,
    brand TEXT,
    model TEXT,
    gtin TEXT,
    es_bundle BOOLEAN,
    esta_mapeado BOOLEAN,
    effective_catalog_product_id TEXT,
    variations_count INTEGER,
    articulo_id TEXT,
    cantidad_requerida INTEGER,
    articulo_nombre TEXT,
    articulo_codigo_universal TEXT,
    articulo_codigo_sat TEXT,
    local_stock INTEGER,
    total_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    WITH dst_pubs AS MATERIALIZED (
        SELECT
            dp.id,
            dp.seller_sku,
            dp.seller_custom_field,
            dp.gtin
        FROM public.publicaciones_externas dp
        WHERE dp.marketplace_id = p_target_marketplace_id
          AND dp.status_externo IN ('active', 'paused', 'under_review')
    ),
    dst_by_art AS MATERIALIZED (
        SELECT DISTINCT
            m.articulo_id,
            COALESCE(m.cantidad_requerida, 1) AS qty
        FROM dst_pubs dp
        JOIN public.mapeo_publicacion_articulo m
          ON m.publicacion_id = dp.id
        WHERE m.articulo_id IS NOT NULL
    ),
    dst_by_sku AS MATERIALIZED (
        SELECT DISTINCT UPPER(BTRIM(s.sku)) AS sku_norm
        FROM dst_pubs dp
        CROSS JOIN LATERAL (VALUES (dp.seller_sku), (dp.seller_custom_field)) AS s(sku)
        WHERE s.sku IS NOT NULL
          AND BTRIM(s.sku) <> ''
          AND s.sku !~ '^[0-9a-fA-F]{8}$'
    ),
    dst_by_gtin AS MATERIALIZED (
        SELECT DISTINCT BTRIM(dp.gtin) AS gtin
        FROM dst_pubs dp
        WHERE dp.gtin IS NOT NULL
          AND BTRIM(dp.gtin) ~ '^[0-9]{8,14}$'
    ),
    base_candidates AS (
        SELECT
            p_src.id AS publicacion_id,
            p_src.external_item_id,
            p_src.titulo,
            p_src.url_imagen,
            p_src.permalink,
            p_src.precio_venta,
            p_src.stock_publicado,
            p_src.status_externo,
            p_src.listing_type_id,
            p_src.category_id,
            p_src.domain_id,
            p_src.logistic_type,
            COALESCE(p_src.free_shipping, false) AS free_shipping,
            COALESCE(
                NULLIF(BTRIM(p_src.seller_custom_field), ''),
                NULLIF(BTRIM(p_src.seller_sku), '')
            ) AS effective_sku_raw,
            p_src.brand,
            p_src.model,
            BTRIM(p_src.gtin) AS effective_gtin,
            COALESCE(p_src.es_bundle, false) AS es_bundle,
            (sm.articulo_id IS NOT NULL) AS esta_mapeado,
            NULLIF(BTRIM(p_src.id_producto_catalogo), '') AS direct_catalog_product_id,
            sm.articulo_id,
            COALESCE(sm.cantidad_requerida, 1) AS cantidad_requerida,
            COALESCE(p_src.sold_quantity, 0) AS sold_quantity
        FROM public.publicaciones_externas p_src
        LEFT JOIN LATERAL (
            SELECT m.articulo_id, COALESCE(m.cantidad_requerida, 1) AS cantidad_requerida
            FROM public.mapeo_publicacion_articulo m
            WHERE m.publicacion_id = p_src.id
            ORDER BY m.created_at ASC
            LIMIT 1
        ) sm ON true
        WHERE p_src.marketplace_id = p_source_marketplace_id
          AND p_src.external_variation_id = '0'
          AND p_src.status_externo = 'active'
          AND p_src.tipo_publicacion IN ('tradicional', 'up')
          AND p_src.channels IS DISTINCT FROM ARRAY['private']::text[]
          AND NOT (
              sm.articulo_id IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM dst_by_art da
                  WHERE da.articulo_id = sm.articulo_id
                    AND da.qty = COALESCE(sm.cantidad_requerida, 1)
              )
          )
          AND NOT (
              COALESCE(NULLIF(BTRIM(p_src.seller_custom_field), ''), NULLIF(BTRIM(p_src.seller_sku), '')) IS NOT NULL
              AND COALESCE(NULLIF(BTRIM(p_src.seller_custom_field), ''), NULLIF(BTRIM(p_src.seller_sku), '')) !~ '^[0-9a-fA-F]{8}$'
              AND EXISTS (
                  SELECT 1 FROM dst_by_sku ds
                  WHERE ds.sku_norm = UPPER(COALESCE(NULLIF(BTRIM(p_src.seller_custom_field), ''), NULLIF(BTRIM(p_src.seller_sku), '')))
              )
          )
          AND NOT (
              COALESCE(p_src.es_bundle, false) = false
              AND BTRIM(COALESCE(p_src.gtin, '')) ~ '^[0-9]{8,14}$'
              AND EXISTS (
                  SELECT 1 FROM dst_by_gtin dg
                  WHERE dg.gtin = BTRIM(p_src.gtin)
              )
          )
          AND (
              NULLIF(BTRIM(p_search), '') IS NULL
              OR p_src.titulo ILIKE '%' || BTRIM(p_search) || '%'
              OR p_src.external_item_id ILIKE '%' || BTRIM(p_search) || '%'
              OR COALESCE(p_src.seller_sku, '') ILIKE '%' || BTRIM(p_search) || '%'
              OR COALESCE(p_src.seller_custom_field, '') ILIKE '%' || BTRIM(p_search) || '%'
              OR COALESCE(p_src.brand, '') ILIKE '%' || BTRIM(p_search) || '%'
              OR COALESCE(p_src.model, '') ILIKE '%' || BTRIM(p_search) || '%'
              OR COALESCE(p_src.gtin, '') ILIKE '%' || BTRIM(p_search) || '%'
              OR COALESCE(sm.articulo_id, '') ILIKE '%' || BTRIM(p_search) || '%'
          )
          AND (
              NULLIF(BTRIM(p_brand), '') IS NULL
              OR UPPER(BTRIM(COALESCE(p_src.brand, ''))) = UPPER(BTRIM(p_brand))
          )
          AND (
              NULLIF(BTRIM(p_category_id), '') IS NULL
              OR p_src.category_id = BTRIM(p_category_id)
          )
          AND (
              COALESCE(p_mapped_filter, 'all') = 'all'
              OR (p_mapped_filter = 'mapped' AND sm.articulo_id IS NOT NULL)
              OR (p_mapped_filter = 'unmapped' AND sm.articulo_id IS NULL)
          )
          AND (
              COALESCE(p_stock_filter, 'all') = 'all'
              OR (p_stock_filter = 'with_stock' AND COALESCE(p_src.stock_publicado, 0) > 0)
              OR (p_stock_filter = 'zero_stock' AND COALESCE(p_src.stock_publicado, 0) = 0)
              OR (p_stock_filter = 'full' AND p_src.logistic_type = 'fulfillment')
              OR (p_stock_filter = 'non_full' AND COALESCE(p_src.logistic_type, '') <> 'fulfillment')
          )
          AND (
              COALESCE(p_catalog_filter, 'all') = 'all'
              OR (
                  p_catalog_filter = 'with_catalog' AND (
                      NULLIF(BTRIM(p_src.id_producto_catalogo), '') IS NOT NULL
                      OR EXISTS (
                          SELECT 1
                          FROM public.publicaciones_externas c
                          WHERE c.marketplace_id = p_source_marketplace_id
                            AND c.par_item_id = p_src.external_item_id
                            AND c.id_producto_catalogo IS NOT NULL
                            AND c.status_externo <> 'closed'
                      )
                  )
              )
              OR (
                  p_catalog_filter = 'without_catalog' AND (
                      NULLIF(BTRIM(p_src.id_producto_catalogo), '') IS NULL
                      AND NOT EXISTS (
                          SELECT 1
                          FROM public.publicaciones_externas c
                          WHERE c.marketplace_id = p_source_marketplace_id
                            AND c.par_item_id = p_src.external_item_id
                            AND c.id_producto_catalogo IS NOT NULL
                            AND c.status_externo <> 'closed'
                      )
                  )
              )
          )
    ),
    paged AS MATERIALIZED (
        SELECT
            b.*,
            COUNT(*) OVER()::bigint AS total_count
        FROM base_candidates b
        ORDER BY b.sold_quantity DESC, b.titulo ASC
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    )
    SELECT
        p.publicacion_id,
        p.external_item_id,
        p.titulo,
        p.url_imagen,
        p.permalink,
        p.precio_venta,
        p.stock_publicado,
        p.status_externo,
        p.listing_type_id,
        p.category_id,
        p.domain_id,
        p.logistic_type,
        p.free_shipping,
        CASE
            WHEN p.effective_sku_raw IS NOT NULL AND p.effective_sku_raw ~ '^[0-9a-fA-F]{8}$' THEN NULL
            ELSE p.effective_sku_raw
        END AS seller_sku,
        p.brand,
        p.model,
        p.effective_gtin AS gtin,
        p.es_bundle,
        p.esta_mapeado,
        COALESCE(p.direct_catalog_product_id, scc.id_producto_catalogo) AS effective_catalog_product_id,
        COALESCE(sv.var_count, 0)::integer AS variations_count,
        p.articulo_id,
        p.cantidad_requerida,
        art.nombre AS articulo_nombre,
        art.codigo_universal AS articulo_codigo_universal,
        art.codigo_sat AS articulo_codigo_sat,
        CASE
            WHEN art.articulo_id IS NULL THEN NULL
            ELSE GREATEST(0, COALESCE(inv.physical_stock, 0) + COALESCE(inv.dropship_stock, 0) - COALESCE(inv.reserved_stock, 0))::integer
        END AS local_stock,
        p.total_count
    FROM paged p
    LEFT JOIN LATERAL (
        SELECT c.id_producto_catalogo
        FROM public.publicaciones_externas c
        WHERE p.direct_catalog_product_id IS NULL
          AND c.marketplace_id = p_source_marketplace_id
          AND c.par_item_id = p.external_item_id
          AND c.id_producto_catalogo IS NOT NULL
          AND c.status_externo <> 'closed'
        ORDER BY (c.status_externo = 'active') DESC
        LIMIT 1
    ) scc ON true
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::integer AS var_count
        FROM public.publicaciones_externas v
        WHERE v.marketplace_id = p_source_marketplace_id
          AND v.external_item_id = p.external_item_id
          AND v.external_variation_id <> '0'
          AND v.status_externo <> 'closed'
    ) sv ON true
    LEFT JOIN public.articulos art
      ON art.articulo_id = p.articulo_id
    LEFT JOIN public.inventory_snapshot inv
      ON inv.sku = p.articulo_id
    ORDER BY p.sold_quantity DESC, p.titulo ASC;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_publicaciones_pendientes_replicar(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_publicaciones_pendientes_replicar(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO service_role;
