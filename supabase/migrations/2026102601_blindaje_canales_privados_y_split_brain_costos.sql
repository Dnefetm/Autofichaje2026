-- 2026102601: Blindaje contra canales privados y resolución de split-brain de costos por duplicidad de artículos

-- =============================================================================
-- PARTE 1: Respaldo y limpieza de publicaciones channels = ['private'] (sin 'marketplace')
-- =============================================================================

-- 1.0 Higiene de channels: asegurar que no queden valores NULL y fijar default '{}'
UPDATE public.publicaciones_externas SET channels = '{}' WHERE channels IS NULL;
ALTER TABLE public.publicaciones_externas ALTER COLUMN channels SET DEFAULT '{}';

-- 1.1 Asegurar que la tabla mapeo_desvinculados_log cuenta con todas las columnas de auditoría
ALTER TABLE public.mapeo_desvinculados_log
  ADD COLUMN IF NOT EXISTS mapeo_id UUID,
  ADD COLUMN IF NOT EXISTS titulo TEXT,
  ADD COLUMN IF NOT EXISTS status_externo TEXT,
  ADD COLUMN IF NOT EXISTS sub_status TEXT[],
  ADD COLUMN IF NOT EXISTS usuario_o_proceso TEXT;

-- 1.2 Respaldar en el log los mapeos de publicaciones privadas sin marketplace
INSERT INTO public.mapeo_desvinculados_log (
  mapeo_id,
  publicacion_id,
  articulo_id,
  cantidad_requerida,
  sincronizar_stock,
  external_item_id,
  titulo,
  status_externo,
  sub_status,
  motivo,
  usuario_o_proceso,
  metadata
)
SELECT 
  m.id AS mapeo_id,
  m.publicacion_id,
  m.articulo_id,
  m.cantidad_requerida,
  m.sincronizar_stock,
  pe.external_item_id,
  pe.titulo,
  pe.status_externo,
  pe.sub_status,
  'limpieza_canal_privado_meli_sin_marketplace' AS motivo,
  'migration_2026102601' AS usuario_o_proceso,
  jsonb_build_object(
    'channels', pe.channels,
    'tipo_publicacion', pe.tipo_publicacion,
    'precio_venta', pe.precio_venta
  ) AS metadata
FROM public.mapeo_publicacion_articulo m
JOIN public.publicaciones_externas pe ON pe.id = m.publicacion_id
WHERE 'private' = ANY(COALESCE(pe.channels, '{}'))
  AND NOT ('marketplace' = ANY(COALESCE(pe.channels, '{}')))
ON CONFLICT DO NOTHING;

-- 1.3 Borrar borradores de precio de publicaciones privadas sin marketplace
DELETE FROM public.publication_pricing_drafts d
USING public.publicaciones_externas pe
WHERE pe.id = d.publicacion_id
  AND 'private' = ANY(COALESCE(pe.channels, '{}'))
  AND NOT ('marketplace' = ANY(COALESCE(pe.channels, '{}')));

-- 1.4 Borrar mapeos activos de publicaciones privadas sin marketplace
DELETE FROM public.mapeo_publicacion_articulo m
USING public.publicaciones_externas pe
WHERE pe.id = m.publicacion_id
  AND 'private' = ANY(COALESCE(pe.channels, '{}'))
  AND NOT ('marketplace' = ANY(COALESCE(pe.channels, '{}')));

-- 1.5 Actualizar estado en publicaciones_externas para desvincularlas completamente
UPDATE public.publicaciones_externas
SET 
  esta_mapeado = false,
  par_item_id = NULL,
  es_fuente_stock = false,
  actualizado_el = NOW()
WHERE 'private' = ANY(COALESCE(channels, '{}'))
  AND NOT ('marketplace' = ANY(COALESCE(channels, '{}')));


-- =============================================================================
-- PARTE 2: Blindar recalcular_par_item_id y fix_par_item_id_faltantes
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recalcular_par_item_id(p_account_id uuid, p_item_ids text[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH pares AS (
  SELECT DISTINCT ON (a.id)
    a.id,
    b.external_item_id AS par_item_id
  FROM publicaciones_externas a
  JOIN publicaciones_externas b
    ON a.id_producto_catalogo = b.id_producto_catalogo
    AND a.marketplace_id = b.marketplace_id
    AND a.external_item_id != b.external_item_id
    AND a.external_variation_id = '0'
    AND b.external_variation_id = '0'
    AND (
      (a.tipo_publicacion = 'tradicional'
        AND b.tipo_publicacion IN ('catalogo', 'catalogo_derivada'))
      OR
      (a.tipo_publicacion IN ('catalogo', 'catalogo_derivada')
        AND b.tipo_publicacion = 'tradicional')
    )
  WHERE a.marketplace_id = p_account_id
    AND a.external_item_id = ANY(p_item_ids)
    AND a.status_externo != 'closed'
    AND NOT ('private' = ANY(COALESCE(a.channels, '{}')) AND NOT ('marketplace' = ANY(COALESCE(a.channels, '{}'))))
    AND b.status_externo != 'closed'
    AND NOT ('private' = ANY(COALESCE(b.channels, '{}')) AND NOT ('marketplace' = ANY(COALESCE(b.channels, '{}'))))
  ORDER BY
    a.id,
    CASE WHEN b.status_externo = 'active' THEN 0 ELSE 1 END,
    COALESCE(b.sold_quantity, 0) DESC
)
UPDATE publicaciones_externas pe
SET par_item_id = pares.par_item_id
FROM pares
WHERE pe.id = pares.id;
$function$;

CREATE OR REPLACE FUNCTION public.fix_par_item_id_faltantes(p_marketplace_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  UPDATE publicaciones_externas AS cat
  SET    par_item_id = trad.external_item_id
  FROM   publicaciones_externas AS trad
  WHERE  cat.marketplace_id = p_marketplace_id
    AND  cat.tipo_publicacion IN ('catalogo', 'catalogo_derivada')
    AND  cat.par_item_id IS NULL
    AND  cat.id_producto_catalogo IS NOT NULL
    AND  cat.status_externo != 'closed'
    AND  NOT ('private' = ANY(COALESCE(cat.channels, '{}')) AND NOT ('marketplace' = ANY(COALESCE(cat.channels, '{}'))))
    AND  trad.tipo_publicacion = 'tradicional'
    AND  trad.id_producto_catalogo = cat.id_producto_catalogo
    AND  trad.external_variation_id = '0'
    AND  trad.status_externo != 'closed'
    AND  NOT ('private' = ANY(COALESCE(trad.channels, '{}')) AND NOT ('marketplace' = ANY(COALESCE(trad.channels, '{}'))));
$function$;

CREATE OR REPLACE FUNCTION public.buscar_publicaciones(p_term text, p_marketplace_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, external_item_id text, external_variation_id text, titulo text, tipo_publicacion text, status_externo text, listing_type_id text, precio_venta numeric, sold_quantity integer, stock_publicado integer, health double precision, seller_custom_field text, seller_sku text, brand text, url_imagen text, par_item_id text, id_producto_catalogo text, catalog_count integer, associated_count integer, posible_eliminada boolean, es_bundle boolean, free_shipping boolean, logistic_type text, original_price numeric, domain_id text, condition text, tags text[], permalink text, esta_mapeado boolean, marketplace_id uuid, sync_disabled boolean, model text, ean text, gtin text, upc text, variation_attributes jsonb, comision_porcentaje numeric, visits_30d integer, relevance_score integer, total_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  WITH matches AS (
    SELECT
      pe.id, pe.external_item_id, pe.external_variation_id,
      pe.titulo, pe.tipo_publicacion, pe.status_externo,
      pe.listing_type_id, pe.precio_venta, pe.sold_quantity,
      pe.stock_publicado, pe.health, pe.seller_custom_field,
      pe.seller_sku, pe.brand, pe.url_imagen, pe.par_item_id,
      pe.id_producto_catalogo, pe.catalog_count, pe.associated_count,
      pe.posible_eliminada,
      pe.es_bundle, pe.free_shipping, pe.logistic_type,
      pe.original_price, pe.domain_id, pe.condition,
      pe.tags, pe.permalink, pe.esta_mapeado, pe.marketplace_id,
      pe.sync_disabled, pe.model, pe.ean, pe.gtin, pe.upc, pe.variation_attributes,
      pe.comision_porcentaje, pe.visits_30d,
      CASE
        WHEN pe.seller_custom_field = p_term               THEN 100
        WHEN pe.seller_sku = p_term                        THEN 100
        WHEN pe.external_item_id = p_term                  THEN 100
        WHEN pe.inventory_id = p_term                      THEN 100
        WHEN pe.ean = p_term                               THEN 95
        WHEN pe.gtin = p_term                              THEN 95
        WHEN pe.upc = p_term                               THEN 95
        WHEN pe.model = p_term                             THEN 90
        WHEN pe.seller_custom_field ILIKE p_term || '%'    THEN 80
        WHEN pe.seller_sku          ILIKE p_term || '%'    THEN 80
        WHEN pe.inventory_id        ILIKE p_term || '%'    THEN 80
        WHEN pe.external_item_id    ILIKE p_term || '%'    THEN 60
        WHEN pe.model               ILIKE p_term || '%'    THEN 50
        WHEN pe.seller_custom_field ILIKE '%' || p_term || '%' THEN 40
        WHEN pe.seller_sku          ILIKE '%' || p_term || '%' THEN 40
        WHEN pe.external_item_id    ILIKE '%' || p_term || '%' THEN 30
        WHEN pe.inventory_id        ILIKE '%' || p_term || '%' THEN 30
        WHEN pe.ean                 ILIKE '%' || p_term || '%' THEN 25
        WHEN pe.gtin                ILIKE '%' || p_term || '%' THEN 25
        WHEN pe.upc                 ILIKE '%' || p_term || '%' THEN 25
        WHEN pe.titulo              ILIKE '%' || p_term || '%' THEN 20
        WHEN pe.brand               ILIKE '%' || p_term || '%' THEN 15
        WHEN pe.model               ILIKE '%' || p_term || '%' THEN 10
        ELSE 0
      END AS relevance_score,
      0::bigint AS total_count
    FROM public.publicaciones_externas pe
    WHERE
      (p_marketplace_id IS NULL OR pe.marketplace_id = p_marketplace_id)
      AND pe.external_variation_id = '0'
      AND NOT ('private' = ANY(COALESCE(pe.channels, '{}')) AND NOT ('marketplace' = ANY(COALESCE(pe.channels, '{}'))))
      AND (
        pe.titulo               ILIKE '%' || p_term || '%'
        OR pe.external_item_id  ILIKE '%' || p_term || '%'
        OR pe.inventory_id      ILIKE '%' || p_term || '%'
        OR pe.seller_custom_field = p_term
        OR pe.seller_sku          = p_term
        OR pe.seller_custom_field ILIKE '%' || p_term || '%'
        OR pe.seller_sku          ILIKE '%' || p_term || '%'
        OR pe.brand               ILIKE '%' || p_term || '%'
        OR pe.model               ILIKE '%' || p_term || '%'
        OR pe.ean                 ILIKE '%' || p_term || '%'
        OR pe.gtin                ILIKE '%' || p_term || '%'
        OR pe.upc                 ILIKE '%' || p_term || '%'
      )
  )
  SELECT *
  FROM matches
  WHERE relevance_score > 0
  ORDER BY relevance_score DESC, sold_quantity DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
$function$;


-- =============================================================================
-- PARTE 3: Blindar public.v_urgencia_precios
-- =============================================================================

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
    END AS estado_auditoria
FROM public.publicaciones_externas pe
JOIN public.publication_pricing_drafts d ON d.publicacion_id = pe.id
WHERE d.draft_price > 0 
  AND d.pricing_status != 'missing_cost'
  AND (pe.external_variation_id IS NULL OR pe.external_variation_id = '' OR pe.external_variation_id = '0')
  AND pe.status_externo != 'closed'
  AND NOT ('deleted' = ANY(COALESCE(pe.sub_status, '{}')))
  AND NOT ('private' = ANY(COALESCE(pe.channels, '{}')) AND NOT ('marketplace' = ANY(COALESCE(pe.channels, '{}'))))
  AND NOT (pe.status_externo = 'paused' AND COALESCE(pe.precio_venta, 0) <= 0);

GRANT SELECT ON public.v_urgencia_precios TO anon, authenticated, service_role;


-- =============================================================================
-- PARTE 4: Resolver el Split-Brain de Costos
-- =============================================================================

-- 4.1 Actualizar public.fn_costo_articulo_vigente
CREATE OR REPLACE FUNCTION public.fn_costo_articulo_vigente(
  p_articulo_id TEXT,
  p_tipo_costo  TEXT
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT pp.valor
  FROM public.proveedor_articulos_alias pa
  JOIN public.precios_proveedor pp
    ON pp.proveedor = pa.proveedor
   AND pp.sku_proveedor = btrim(pa.modelo_excel)
  WHERE (
    pa.articulo_id = p_articulo_id
    OR pa.articulo_id IN (
      SELECT a2.articulo_id
      FROM public.articulos a1
      JOIN public.articulos a2
        ON lower(btrim(a2.marca)) = lower(btrim(a1.marca))
       AND lower(btrim(a2.modelo)) = lower(btrim(a1.modelo))
      WHERE a1.articulo_id = p_articulo_id
        AND a1.marca IS NOT NULL AND btrim(a1.marca) <> ''
        AND a1.modelo IS NOT NULL AND btrim(a1.modelo) <> ''
    )
  )
    AND pa.modelo_excel IS NOT NULL
    AND btrim(pa.modelo_excel) <> ''
    AND pp.vigente = true
    AND pp.valor > 0
    AND public.fn_normalizar_tipo_costo(pp.tipo_costo)
        = public.fn_normalizar_tipo_costo(p_tipo_costo)
  ORDER BY
    CASE WHEN pa.articulo_id = p_articulo_id THEN 0 ELSE 1 END,
    pa.locked DESC,
    pa.ultima_vez_visto DESC NULLS LAST,
    pa.creado_el DESC,
    pp.creado_el DESC
  LIMIT 1;
$$;

-- 4.2 Actualizar public.fn_resolver_regla_canonico
CREATE OR REPLACE FUNCTION public.fn_resolver_regla_canonico(
  p_articulo_id    TEXT,
  p_marketplace_id UUID,
  p_category_id    TEXT
) RETURNS pricing_rule_v3
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_proveedor TEXT;
  v_marca     TEXT;
  v_costo     NUMERIC;
  v_rule      public.pricing_rule_v3;
BEGIN
  -- Proveedor del artículo: alias directo o hermano con mismo (marca, modelo)
  SELECT pa.proveedor INTO v_proveedor
  FROM public.proveedor_articulos_alias pa
  WHERE (
    pa.articulo_id = p_articulo_id
    OR pa.articulo_id IN (
      SELECT a2.articulo_id
      FROM public.articulos a1
      JOIN public.articulos a2
        ON lower(btrim(a2.marca)) = lower(btrim(a1.marca))
       AND lower(btrim(a2.modelo)) = lower(btrim(a1.modelo))
      WHERE a1.articulo_id = p_articulo_id
        AND a1.marca IS NOT NULL AND btrim(a1.marca) <> ''
        AND a1.modelo IS NOT NULL AND btrim(a1.modelo) <> ''
    )
  )
  ORDER BY
    CASE WHEN pa.articulo_id = p_articulo_id THEN 0 ELSE 1 END,
    pa.locked DESC,
    pa.ultima_vez_visto DESC NULLS LAST,
    pa.creado_el DESC
  LIMIT 1;

  -- Marca del artículo (fallback al alias bloqueado)
  SELECT a.marca INTO v_marca
  FROM public.articulos a
  WHERE a.articulo_id = p_articulo_id;
  IF v_marca IS NULL OR v_marca = '' THEN
    SELECT pa.marca_excel INTO v_marca
    FROM public.proveedor_articulos_alias pa
    WHERE (
      pa.articulo_id = p_articulo_id
      OR pa.articulo_id IN (
        SELECT a2.articulo_id
        FROM public.articulos a1
        JOIN public.articulos a2
          ON lower(btrim(a2.marca)) = lower(btrim(a1.marca))
         AND lower(btrim(a2.modelo)) = lower(btrim(a1.modelo))
        WHERE a1.articulo_id = p_articulo_id
          AND a1.marca IS NOT NULL AND btrim(a1.marca) <> ''
          AND a1.modelo IS NOT NULL AND btrim(a1.modelo) <> ''
      )
    )
      AND pa.locked = true
    ORDER BY
      CASE WHEN pa.articulo_id = p_articulo_id THEN 0 ELSE 1 END,
      pa.creado_el DESC
    LIMIT 1;
  END IF;

  -- Costo de referencia (solo para rangos precio_min/precio_max) — fuente canónica
  v_costo := public.fn_costo_articulo_vigente(p_articulo_id, 'menudeo');

  -- Regla más específica que cumpla TODOS los criterios definidos
  SELECT * INTO v_rule
  FROM public.pricing_rule_v3 r
  WHERE r.is_active = true
    AND (r.marketplace_id IS NULL OR r.marketplace_id = p_marketplace_id)
    AND (r.proveedor     IS NULL OR lower(r.proveedor) = lower(COALESCE(v_proveedor, '')))
    AND (r.marca         IS NULL OR r.marca = '' OR v_marca ILIKE ANY (string_to_array(replace(r.marca, ', ', ','), ',')))
    AND (r.category_id   IS NULL OR r.category_id = '' OR p_category_id ILIKE ANY (string_to_array(replace(r.category_id, ', ', ','), ',')))
    AND (r.articulo_id   IS NULL OR r.articulo_id = '' OR r.articulo_id = p_articulo_id)
    AND (r.precio_min    IS NULL OR v_costo >= r.precio_min)
    AND (r.precio_max    IS NULL OR v_costo <= r.precio_max)
  ORDER BY
    (CASE WHEN r.articulo_id   IS NOT NULL AND r.articulo_id != '' THEN 1 ELSE 0 END
   + CASE WHEN r.proveedor     IS NOT NULL AND r.proveedor != '' THEN 1 ELSE 0 END
   + CASE WHEN r.category_id   IS NOT NULL AND r.category_id != '' THEN 1 ELSE 0 END
   + CASE WHEN r.marca         IS NOT NULL AND r.marca != '' THEN 1 ELSE 0 END
   + CASE WHEN r.marketplace_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.precio_min    IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN r.precio_max    IS NOT NULL THEN 1 ELSE 0 END) DESC,
    r.priority ASC
  LIMIT 1;

  RETURN v_rule;
END;
$function$;

-- 4.3 Actualizar public.fn_calcular_precio_prepublicacion
CREATE OR REPLACE FUNCTION public.fn_calcular_precio_prepublicacion(
  p_articulo_id        TEXT,
  p_marketplace_id     UUID,
  p_category_id        TEXT,
  p_listing_type_id    TEXT,
  p_force_rule_id      UUID DEFAULT NULL,
  p_cantidad_requerida INTEGER DEFAULT 1
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rule                public.pricing_rule_v3;
  v_proveedor           TEXT;
  v_costo_base          NUMERIC(12,2);
  v_commission_pct      NUMERIC(5,2);
  v_withholding_pct     NUMERIC(5,2);
  v_comision_efectiva   NUMERIC(5,2);
  v_retenciones_efectiva NUMERIC(5,2);
  v_numerador           NUMERIC(12,2);
  v_denominador         NUMERIC(8,4);
  v_precio_final        NUMERIC(12,2);
BEGIN
  SELECT pa.proveedor INTO v_proveedor
  FROM public.proveedor_articulos_alias pa
  WHERE (
    pa.articulo_id = p_articulo_id
    OR pa.articulo_id IN (
      SELECT a2.articulo_id
      FROM public.articulos a1
      JOIN public.articulos a2
        ON lower(btrim(a2.marca)) = lower(btrim(a1.marca))
       AND lower(btrim(a2.modelo)) = lower(btrim(a1.modelo))
      WHERE a1.articulo_id = p_articulo_id
        AND a1.marca IS NOT NULL AND btrim(a1.marca) <> ''
        AND a1.modelo IS NOT NULL AND btrim(a1.modelo) <> ''
    )
  )
  ORDER BY
    CASE WHEN pa.articulo_id = p_articulo_id THEN 0 ELSE 1 END,
    pa.locked DESC,
    pa.ultima_vez_visto DESC NULLS LAST,
    pa.creado_el DESC
  LIMIT 1;

  v_rule := public.fn_resolver_regla_prepublicacion(p_articulo_id, p_marketplace_id, p_category_id);

  IF p_force_rule_id IS NOT NULL THEN
    SELECT * INTO v_rule FROM public.pricing_rule_v3 WHERE id = p_force_rule_id AND is_active = true;
  END IF;

  IF v_rule IS NULL THEN
    RETURN jsonb_build_object('status','no_rule','sale_price',NULL,'proveedor',v_proveedor,'reason','Sin regla de precio para este artículo/tienda/categoría');
  END IF;

  v_costo_base := public.fn_costo_articulo_vigente(p_articulo_id, v_rule.cost_basis)
                  * GREATEST(1, COALESCE(p_cantidad_requerida, 1));
  IF v_costo_base IS NULL OR v_costo_base <= 0 THEN
    RETURN jsonb_build_object('status','missing_cost','sale_price',NULL,'proveedor',v_proveedor,'cost_basis',v_rule.cost_basis,'reason','Sin costo vigente ('||v_rule.cost_basis||') para este artículo');
  END IF;

  SELECT commission_effective, withholding_effective
    INTO v_commission_pct, v_withholding_pct
  FROM public.v_category_pricing_params
  WHERE category_id = p_category_id
    AND listing_type_id = p_listing_type_id
  ORDER BY commission_source DESC NULLS LAST, withholding_source DESC NULLS LAST, commission_effective DESC, withholding_effective DESC
  LIMIT 1;

  IF v_commission_pct IS NULL THEN
    v_commission_pct := 15.0;
    v_withholding_pct := 8.96;
  END IF;

  v_comision_efectiva    := CASE WHEN COALESCE(v_rule.aplicar_comision, true)    THEN v_commission_pct  ELSE 0.0 END;
  v_retenciones_efectiva := CASE WHEN COALESCE(v_rule.aplicar_retenciones, true) THEN v_withholding_pct ELSE 0.0 END;

  v_numerador := v_costo_base * (1.0 + (CASE WHEN COALESCE(v_rule.aplicar_margen, true) THEN v_rule.margen_objetivo ELSE 0.0 END)/100.0)
                 + (CASE WHEN COALESCE(v_rule.aplicar_envio, true) THEN COALESCE(v_rule.envio_fijo,0) ELSE 0.0 END);
  v_denominador := 1.0 - (v_comision_efectiva + v_retenciones_efectiva)/100.0;

  IF v_denominador <= 0 THEN
    RETURN jsonb_build_object('status','invalid_strategy','sale_price',NULL,'proveedor',v_proveedor,'reason','Comisión + retenciones >= 100%');
  END IF;

  v_precio_final := v_numerador / v_denominador;

  v_precio_final := CASE v_rule.redondeo
    WHEN '99' THEN FLOOR(v_precio_final / 10) * 10 + 9
    WHEN '00' THEN ROUND(v_precio_final / 10) * 10
    WHEN '5'  THEN ROUND(v_precio_final / 5)  * 5
    ELSE ROUND(v_precio_final, 2)
  END;

  RETURN jsonb_build_object(
    'status','valid','sale_price',v_precio_final,'base_price',v_costo_base,'currency','MXN',
    'proveedor',v_proveedor,'rule_id',v_rule.id,'rule_name',v_rule.name,'cost_basis',v_rule.cost_basis,
    'margen_pct',v_rule.margen_objetivo,'comision_pct',v_comision_efectiva,'retenciones_pct',v_retenciones_efectiva,
    'envio_fijo',v_rule.envio_fijo,'listing_type_id',p_listing_type_id,'cantidad_requerida',GREATEST(1, COALESCE(p_cantidad_requerida,1))
  );
END;
$function$;

-- 4.4 Re-apuntar en public.proveedor_articulos_alias
WITH alias_sin_mapeo AS (
  SELECT pa.id AS alias_id, pa.articulo_id AS old_articulo_id,
         lower(btrim(a1.marca)) AS marca_norm,
         lower(btrim(a1.modelo)) AS modelo_norm
  FROM public.proveedor_articulos_alias pa
  JOIN public.articulos a1 ON a1.articulo_id = pa.articulo_id
  WHERE a1.marca IS NOT NULL AND btrim(a1.marca) <> ''
    AND a1.modelo IS NOT NULL AND btrim(a1.modelo) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.mapeo_publicacion_articulo m WHERE m.articulo_id = pa.articulo_id
    )
),
hermanos_con_mapeo AS (
  SELECT DISTINCT ON (asm.alias_id)
    asm.alias_id,
    a2.articulo_id AS new_articulo_id
  FROM alias_sin_mapeo asm
  JOIN public.articulos a2
    ON lower(btrim(a2.marca)) = asm.marca_norm
   AND lower(btrim(a2.modelo)) = asm.modelo_norm
   AND a2.articulo_id <> asm.old_articulo_id
  WHERE EXISTS (
    SELECT 1 FROM public.mapeo_publicacion_articulo m WHERE m.articulo_id = a2.articulo_id
  )
  ORDER BY asm.alias_id, a2.creado_el DESC
)
UPDATE public.proveedor_articulos_alias pa
SET articulo_id = h.new_articulo_id
FROM hermanos_con_mapeo h
WHERE pa.id = h.alias_id;

-- 4.5 Recalcular precio para publicaciones mapeadas con borradores en missing_cost o no_rule
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT m.publicacion_id
    FROM public.mapeo_publicacion_articulo m
    JOIN public.publication_pricing_drafts d ON d.publicacion_id = m.publicacion_id
    WHERE d.pricing_status IN ('missing_cost', 'no_rule')
  LOOP
    BEGIN
      PERFORM public.fn_recalcular_precio_publicacion(r.publicacion_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Error recalculando publicacion %: %', r.publicacion_id, SQLERRM;
    END;
  END LOOP;
END;
$$;
