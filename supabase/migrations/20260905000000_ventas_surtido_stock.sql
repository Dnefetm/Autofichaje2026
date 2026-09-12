-- =============================================================================
-- Fase 0.1 — Stock/reserva para ventas a subdistribuidores
-- =============================================================================
-- 1) 'surtido' en el estado del pedido.
-- 2) pedido_items: cantidad_surtida (progreso), fuente_pendiente (origen del
--    faltante) y proveedor (nombre completo, para el socket de stock).
-- 3) reservaciones_stock: acepta pedidos (pedido_item_id + origen), no solo MeLi.
-- 4) Socket para el futuro módulo de stock de proveedor (stub → NULL = sin dato).
-- 5) RPCs atómicas: pedido_reservar (clasificar + reservar) y pedido_surtir
--    (egreso + consumir reserva).
-- =============================================================================

-- 1) Estado 'surtido' ----------------------------------------------------------
DO $$
DECLARE v_con text;
BEGIN
  SELECT conname INTO v_con
  FROM pg_constraint
  WHERE conrelid = 'pedidos'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%borrador%';
  IF v_con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE pedidos DROP CONSTRAINT %I', v_con);
  END IF;
END $$;

ALTER TABLE pedidos ADD CONSTRAINT pedidos_estado_check
  CHECK (estado IN ('borrador','confirmado','surtido','entregado','cancelado'));

-- 2) Columnas de surtido en pedido_items ---------------------------------------
ALTER TABLE pedido_items
  ADD COLUMN IF NOT EXISTS cantidad_surtida integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fuente_pendiente text
    CHECK (fuente_pendiente IN ('proveedor','orden_compra')),
  ADD COLUMN IF NOT EXISTS proveedor text;   -- nombre completo del proveedor

-- 3) Generalizar reservaciones_stock (MeLi + pedidos) --------------------------
ALTER TABLE reservaciones_stock
  ADD COLUMN IF NOT EXISTS pedido_item_id uuid REFERENCES pedido_items(id) ON DELETE CASCADE;
ALTER TABLE reservaciones_stock
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'meli'
    CHECK (origen IN ('meli','pedido'));
ALTER TABLE reservaciones_stock
  ALTER COLUMN orden_item_id DROP NOT NULL;

ALTER TABLE reservaciones_stock DROP CONSTRAINT IF EXISTS reservaciones_stock_origen_check;
ALTER TABLE reservaciones_stock ADD CONSTRAINT reservaciones_stock_origen_check CHECK (
  (origen = 'meli'   AND orden_item_id IS NOT NULL AND pedido_item_id IS NULL) OR
  (origen = 'pedido' AND pedido_item_id IS NOT NULL AND orden_item_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_reservaciones_pedido_item ON reservaciones_stock (pedido_item_id);

-- 4) Socket: stock de proveedor (stub; el módulo real lo reemplaza con la MISMA firma)
--    Devuelve NULL (= sin dato) o la cantidad disponible.
CREATE OR REPLACE FUNCTION public.fn_consultar_stock_proveedor(p_proveedor text, p_modelo text)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT NULL::integer
$$;

-- 5a) RPC: reservar al confirmar -----------------------------------------------
-- Clasifica cada línea y reserva la parte física disponible (atomicidad + lock).
CREATE OR REPLACE FUNCTION public.pedido_reservar(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado text;
  v_linea record;
  v_disponible int;
  v_reservar int;
  v_faltante int;
  v_stock_proveedor int;
  v_proveedor text;
  v_modelo text;
BEGIN
  SELECT estado INTO v_estado FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Pedido % no existe', p_pedido_id;
  END IF;
  IF v_estado <> 'borrador' THEN
    RETURN;  -- idempotente: ya confirmado
  END IF;

  -- Orden estable de sku para evitar deadlocks entre pedidos concurrentes
  FOR v_linea IN
    SELECT * FROM pedido_items WHERE pedido_id = p_pedido_id
    ORDER BY articulo_id NULLS LAST
  LOOP
    v_reservar := 0;

    -- Reservar solo el físico disponible (dropship NO se reserva para subdistribuidor)
    IF v_linea.articulo_id IS NOT NULL THEN
      SELECT GREATEST(0, COALESCE(i.physical_stock,0) - COALESCE(i.reserved_stock,0))
        INTO v_disponible
        FROM inventory_snapshot i
        WHERE i.sku = v_linea.articulo_id
        FOR UPDATE;
      v_disponible := COALESCE(v_disponible, 0);
      v_reservar := LEAST(v_linea.cantidad, v_disponible);

      IF v_reservar > 0 THEN
        INSERT INTO reservaciones_stock (pedido_item_id, articulo_id, cantidad, estado, origen)
        VALUES (v_linea.id, v_linea.articulo_id, v_reservar, 'activa', 'pedido');
      END IF;
    END IF;

    -- Faltante → origen (proveedor u orden de compra) vía socket
    v_faltante := v_linea.cantidad - v_reservar;
    IF v_faltante > 0 THEN
      v_proveedor := NULL;
      v_modelo := NULL;

      IF v_linea.articulo_id IS NOT NULL THEN
        -- Catálogo: proveedor + modelo desde la vinculación más reciente
        SELECT ie.proveedor, vc.sku_proveedor
          INTO v_proveedor, v_modelo
          FROM vinculacion_clasificada vc
          JOIN importaciones_excel ie ON ie.id = vc.importacion_id
          WHERE vc.articulo_id = v_linea.articulo_id
          ORDER BY ie.creado_el DESC
          LIMIT 1;
      ELSE
        -- Lista de proveedor: nombre completo + modelo (snapshot de la línea)
        v_proveedor := v_linea.proveedor;
        v_modelo := v_linea.modelo;
      END IF;

      v_stock_proveedor := public.fn_consultar_stock_proveedor(v_proveedor, v_modelo);

      UPDATE pedido_items
        SET fuente_pendiente = CASE WHEN v_stock_proveedor IS NULL THEN 'orden_compra' ELSE 'proveedor' END
        WHERE id = v_linea.id;
    END IF;
  END LOOP;

  UPDATE pedidos SET estado = 'confirmado' WHERE id = p_pedido_id;
END;
$$;

-- 5b) RPC: surtir (egreso + consumir reserva) ----------------------------------
-- Surtido parcial: solo lo que estaba reservado físicamente. El resto queda
-- "Por surtir" (fuente_pendiente) para compras.
CREATE OR REPLACE FUNCTION public.pedido_surtir(p_pedido_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_estado text;
  v_reserva record;
  v_egreso_id text;
  v_count int := 0;
BEGIN
  SELECT estado INTO v_estado FROM pedidos WHERE id = p_pedido_id FOR UPDATE;
  IF v_estado IS NULL THEN
    RAISE EXCEPTION 'Pedido % no existe', p_pedido_id;
  END IF;

  FOR v_reserva IN
    SELECT r.id, r.pedido_item_id, r.articulo_id, r.cantidad
    FROM reservaciones_stock r
    WHERE r.pedido_item_id IN (SELECT id FROM pedido_items WHERE pedido_id = p_pedido_id)
      AND r.origen = 'pedido'
      AND r.estado = 'activa'
    ORDER BY r.articulo_id
    FOR UPDATE
  LOOP
    v_egreso_id := 'subdist_' || p_pedido_id::text || '_' || v_reserva.pedido_item_id::text;

    -- Egreso real (origin='web' → baja a Sheets). Reutiliza el RPC ya validado.
    PERFORM public.web_upsert_egreso(
      v_egreso_id, v_reserva.articulo_id, v_reserva.cantidad,
      'venta_subdistribuidor', NULL,
      NULL, NULL, NULL, 'Pedido ' || p_pedido_id::text,
      now(),
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL,
      NULL, NULL
    );

    -- Consumir la reserva (libera reserved_stock)
    UPDATE reservaciones_stock SET estado = 'consumida', updated_at = now() WHERE id = v_reserva.id;

    -- Avanzar el surtido de la línea
    UPDATE pedido_items
      SET cantidad_surtida = cantidad_surtida + v_reserva.cantidad
      WHERE id = v_reserva.pedido_item_id;

    v_count := v_count + 1;
  END LOOP;

  -- Si no había stock físico reservado (todo "Por surtir"), no se marca surtido.
  IF v_count > 0 THEN
    UPDATE pedidos SET estado = 'surtido' WHERE id = p_pedido_id;
  END IF;
END;
$$;

-- 6) Seguridad: revocar a público, dejar solo service_role ---------------------
REVOKE EXECUTE ON FUNCTION public.pedido_reservar FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pedido_surtir FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.pedido_reservar TO service_role;
GRANT  EXECUTE ON FUNCTION public.pedido_surtir TO service_role;
