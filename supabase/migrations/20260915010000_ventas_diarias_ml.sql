-- =============================================================================
-- T1 Logística Full — tabla de agregación diaria de ventas por Código ML.
-- Regla de oro: el algoritmo de reposición NO lee la tabla cruda de órdenes;
-- lee esta tabla (una fila por código ML por día), sumando 30-180 filas/producto.
-- Multi-cuenta: incluye marketplace_id para distinguir vendedores.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ventas_diarias_ml (
    marketplace_id      uuid NOT NULL,
    codigo_ml           text NOT NULL,   -- Código Full (inventory_id) de la vitrina
    fecha_dia           date NOT NULL,   -- día de la venta (fecha del pedido)
    unidades_vendidas   integer NOT NULL DEFAULT 0,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (marketplace_id, codigo_ml, fecha_dia)
);

CREATE INDEX IF NOT EXISTS idx_ventas_diarias_ml_fecha
    ON ventas_diarias_ml (fecha_dia);

CREATE INDEX IF NOT EXISTS idx_ventas_diarias_ml_codigo
    ON ventas_diarias_ml (codigo_ml, fecha_dia);

-- RPC de acumulación incremental (upsert sumando unidades).
CREATE OR REPLACE FUNCTION upsert_venta_diaria_ml(
    p_marketplace_id uuid,
    p_codigo_ml      text,
    p_fecha_dia      date,
    p_unidades       integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO ventas_diarias_ml (marketplace_id, codigo_ml, fecha_dia, unidades_vendidas)
    VALUES (p_marketplace_id, p_codigo_ml, p_fecha_dia, COALESCE(p_unidades, 0))
    ON CONFLICT (marketplace_id, codigo_ml, fecha_dia)
    DO UPDATE SET unidades_vendidas = ventas_diarias_ml.unidades_vendidas + EXCLUDED.unidades_vendidas,
                  updated_at = now();
END; $$;

REVOKE EXECUTE ON FUNCTION public.upsert_venta_diaria_ml FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_venta_diaria_ml TO service_role;
