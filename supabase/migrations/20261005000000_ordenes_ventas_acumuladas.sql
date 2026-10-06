-- =============================================================================
-- Logística Full — idempotencia en la acumulación de ventas diarias.
-- =============================================================================
-- El webhook de MeLi puede entregar/reintentar la misma orden varias veces y
-- `process_sale` sumaba cada vez en ventas_diarias_ml (sin verificar si ya lo
-- había hecho), duplicando el histórico. Este flag marca que la orden ya se
-- acumuló para que la acumulación sea idempotente.
-- =============================================================================

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS ventas_acumuladas boolean NOT NULL DEFAULT false;

-- RPC para revertir la acumulación de una orden que pasa a 'cancelled'
-- después de haber sido acumulada (nunca deja el contador en negativo).
CREATE OR REPLACE FUNCTION revertir_venta_diaria_ml(
    p_marketplace_id uuid,
    p_codigo_ml      text,
    p_fecha_dia      date,
    p_unidades       integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE ventas_diarias_ml
       SET unidades_vendidas = GREATEST(0, unidades_vendidas - COALESCE(p_unidades, 0)),
           updated_at = now()
     WHERE marketplace_id = p_marketplace_id
       AND codigo_ml = p_codigo_ml
       AND fecha_dia = p_fecha_dia;
END; $$;

REVOKE EXECUTE ON FUNCTION public.revertir_venta_diaria_ml FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.revertir_venta_diaria_ml TO service_role;
