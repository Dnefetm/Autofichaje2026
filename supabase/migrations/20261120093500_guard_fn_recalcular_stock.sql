-- Migration: 20261120093500_guard_fn_recalcular_stock.sql
-- Description: Guardia defensivo en fn_recalcular_stock para evitar violaciones de foreign key en inventory_snapshot si el SKU no existe en public.articulos

CREATE OR REPLACE FUNCTION public.fn_recalcular_stock(p_articulo_id text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_disponibles    INTEGER;
    v_total_ingresos INTEGER;
    v_total_egresos  INTEGER;
    v_final          INTEGER;
BEGIN
    -- Guard defensivo: si el artículo no existe en el catálogo, salir sin violar fk_inventory_snapshot_articulo
    IF NOT EXISTS (SELECT 1 FROM public.articulos WHERE articulo_id = p_articulo_id) THEN
        RETURN;
    END IF;

    SELECT COALESCE(disponibles, 0) INTO v_disponibles FROM public.articulos WHERE articulo_id = p_articulo_id;
    SELECT COALESCE(SUM(cantidad), 0) INTO v_total_ingresos FROM public.ingresos WHERE articulo_id = p_articulo_id;
    SELECT COALESCE(SUM(cantidad), 0) INTO v_total_egresos  FROM public.egresos  WHERE articulo_id = p_articulo_id;

    v_final := GREATEST(0, v_disponibles + v_total_ingresos - v_total_egresos);

    INSERT INTO public.inventory_snapshot (sku, physical_stock, updated_at)
    VALUES (p_articulo_id, v_final, NOW())
    ON CONFLICT (sku) DO UPDATE
      SET physical_stock = EXCLUDED.physical_stock,
          updated_at     = NOW();
END;
$function$;
