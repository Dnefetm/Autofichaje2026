-- Recalculo masivo de urgencia de precios + edición directa del draft (Motor V3).
-- Reutiliza fn_recalcular_precio_publicacion (única función canónica V3) y
-- respeta la sincronización en espejo tradicional <-> catálogo.

-- 1. Wrapper por lotes: recalcula SOLO borradores pendientes (nunca approved ni override).
CREATE OR REPLACE FUNCTION public.fn_recalcular_urgencia_lote(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    v_id uuid;
    v_count integer := 0;
BEGIN
    FOR v_id IN SELECT unnest(p_ids) LOOP
        IF EXISTS (
            SELECT 1 FROM public.publication_pricing_drafts d
            WHERE d.publicacion_id = v_id
              AND d.pricing_review_status = 'pending'
        ) THEN
            PERFORM public.fn_recalcular_precio_publicacion(v_id);
            v_count := v_count + 1;
        END IF;
    END LOOP;
    RETURN v_count;
END;
$$;

-- 2. Edición directa del precio sugerido (spreadsheet style) con paridad en espejo.
CREATE OR REPLACE FUNCTION public.fn_editar_draft_price(
    p_publicacion_id uuid,
    p_nuevo_precio numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
    IF p_nuevo_precio IS NULL OR p_nuevo_precio <= 0 THEN
        RAISE EXCEPTION 'El precio debe ser mayor a 0';
    END IF;

    -- 1. Actualizar el borrador principal (respetando draft_cost NOT NULL)
    IF EXISTS (SELECT 1 FROM public.publication_pricing_drafts WHERE publicacion_id = p_publicacion_id) THEN
        UPDATE public.publication_pricing_drafts
           SET draft_price = p_nuevo_precio,
               pricing_status = 'valid',
               pricing_review_status = 'pending',
               details = coalesce(details, '{}'::jsonb) || jsonb_build_object('precio_final', p_nuevo_precio, 'manual_override', true),
               updated_at = now()
         WHERE publicacion_id = p_publicacion_id;
    ELSE
        -- Si no existía borrador previo, intentar recalcularlo canónicamente primero
        PERFORM public.fn_recalcular_precio_publicacion(p_publicacion_id);

        -- Upsert seguro con draft_cost asegurado
        INSERT INTO public.publication_pricing_drafts
            (publicacion_id, draft_cost, draft_price, pricing_status, pricing_review_status, details, updated_at)
        VALUES
            (p_publicacion_id, 0, p_nuevo_precio, 'valid', 'pending', jsonb_build_object('precio_final', p_nuevo_precio, 'manual_override', true), now())
        ON CONFLICT (publicacion_id) DO UPDATE
            SET draft_price = EXCLUDED.draft_price,
                pricing_status = 'valid',
                pricing_review_status = 'pending',
                details = coalesce(publication_pricing_drafts.details, '{}'::jsonb) || jsonb_build_object('precio_final', EXCLUDED.draft_price, 'manual_override', true),
                updated_at = now();
    END IF;

    -- 2. Espejo: si la publicación editada es tradicional, actualizar el borrador de su catálogo.
    UPDATE public.publication_pricing_drafts cd
       SET draft_price = p_nuevo_precio,
           pricing_status = 'valid',
           pricing_review_status = 'pending',
           updated_at = now()
      FROM public.publicaciones_externas cat,
           public.publicaciones_externas trad
     WHERE cd.publicacion_id = cat.id
       AND trad.id = p_publicacion_id
       AND cat.tipo_publicacion IN ('catalogo', 'catalogo_derivada')
       AND cat.status_externo != 'closed'
       AND (cat.par_item_id = trad.external_item_id
            OR (cat.id_producto_catalogo = trad.id_producto_catalogo
                AND cat.marketplace_id = trad.marketplace_id));

    -- 3. Espejo inverso: si la editada es catálogo, actualizar el borrador de su tradicional.
    UPDATE public.publication_pricing_drafts td
       SET draft_price = p_nuevo_precio,
           pricing_status = 'valid',
           pricing_review_status = 'pending',
           updated_at = now()
      FROM public.publicaciones_externas cat,
           public.publicaciones_externas trad
     WHERE td.publicacion_id = trad.id
       AND cat.id = p_publicacion_id
       AND trad.tipo_publicacion = 'tradicional'
       AND trad.status_externo != 'closed'
       AND (cat.par_item_id = trad.external_item_id
            OR (cat.id_producto_catalogo = trad.id_producto_catalogo
                AND cat.marketplace_id = trad.marketplace_id));
END;
$$;

-- Restringir ejecución directa: solo vía API autorizada (supabaseAdmin / service_role).
REVOKE ALL ON FUNCTION public.fn_recalcular_urgencia_lote(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_editar_draft_price(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_recalcular_urgencia_lote(uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_editar_draft_price(uuid, numeric) TO service_role;
