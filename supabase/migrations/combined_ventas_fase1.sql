-- =============================================================================
-- Fase 0 — Ventas a subdistribuidores (MVP)
-- =============================================================================
-- Modelo simplificado: el VENDEDOR asigna manualmente el rango de descuento a
-- cada cliente. NO hay reglas automáticas por volumen (eso es trabajo del
-- vendedor, por ahora).
--
-- Base de precio: precio_menudeo (ya existe en precios_proveedor_actual /
-- costos_articulo). El sistema solo aplica el % del rango asignado.
--
-- Datos fiscales en el ticket: solo si el cliente los tiene registrados
-- (rfc / razon_social). Si están vacíos, el ticket sale sin esa sección.
-- =============================================================================

-- 1) Rangos de descuento (configurables por el usuario; no canónicos por cliente)
CREATE TABLE IF NOT EXISTS rangos_descuento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL,
  porcentaje  numeric(5,2) NOT NULL DEFAULT 0,
  activo      boolean NOT NULL DEFAULT true,
  creado_el   timestamptz NOT NULL DEFAULT now()
);

-- 2) Vendedores (preparado para login futuro)
CREATE TABLE IF NOT EXISTS vendedores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      text NOT NULL,
  email       text UNIQUE,
  telefono    text,
  activo      boolean NOT NULL DEFAULT true,
  creado_el   timestamptz NOT NULL DEFAULT now()
);

-- 2b) Proveedores — la tabla YA EXISTE (migración 20260903000004_proveedores_entidad,
--     con PK = nombre, columnas nombre/archivado/creado_el/actualizado_el).
--     Aquí solo agregamos el código corto para el ticket (ej. "Urrea Herramientas" → "UH").
--     No se recrea la tabla (CREATE TABLE IF NOT EXISTS sería un no-op y perdería el campo).
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS codigo_corto text;

-- 3) Clientes (subdistribuidores)
CREATE TABLE IF NOT EXISTS clientes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre             text NOT NULL,
  contacto           text,
  telefono           text,
  direccion          text,
  email              text,
  rfc                text,          -- opcional (datos fiscales)
  razon_social       text,          -- opcional (datos fiscales)
  vendedor_id        uuid REFERENCES vendedores(id),
  rango_descuento_id uuid REFERENCES rangos_descuento(id),
  activo             boolean NOT NULL DEFAULT true,
  creado_el          timestamptz NOT NULL DEFAULT now()
);

-- 4) Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id         uuid NOT NULL REFERENCES clientes(id),
  vendedor_id        uuid REFERENCES vendedores(id),
  fecha              timestamptz NOT NULL DEFAULT now(),
  estado             text NOT NULL DEFAULT 'borrador'
                       CHECK (estado IN ('borrador','confirmado','entregado','cancelado')),
  descuento_aplicado numeric(5,2) NOT NULL DEFAULT 0,  -- % congelado en el pedido
  total              numeric(12,2) NOT NULL DEFAULT 0,
  creado_el          timestamptz NOT NULL DEFAULT now()
);

-- 5) Líneas del pedido — soporta DOS fuentes:
--    a) Catálogo:  articulo_id (referencia articulos.articulo_id)
--    b) Lista de proveedor (aún no en catálogo): proveedor_corto + marca + modelo
--    En ambos casos se guarda un snapshot (descripcion + precio) para que el
--    ticket quede congelado aunque luego se vincule al catálogo.
CREATE TABLE IF NOT EXISTS pedido_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id      uuid NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  articulo_id    text,                 -- catálogo (nullable)
  proveedor_corto text,                -- proveedor (nullable), ej. "UH"
  marca          text,                 -- marca (nullable)
  modelo         text,                 -- modelo/referencia/N° parte (nullable), ej. "9713"
  descripcion    text,                 -- snapshot: nombre del artículo o descripción del proveedor
  cantidad       integer NOT NULL DEFAULT 1,
  precio_menudeo numeric(12,2) NOT NULL DEFAULT 0,
  descuento      numeric(5,2) NOT NULL DEFAULT 0,
  subtotal       numeric(12,2) NOT NULL DEFAULT 0
);

-- 6) Tickets de venta (derivados de un pedido confirmado)
CREATE TABLE IF NOT EXISTS tickets_venta (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid NOT NULL REFERENCES pedidos(id),
  cliente_id  uuid REFERENCES clientes(id),
  vendedor_id uuid REFERENCES vendedores(id),
  folio       text UNIQUE,
  fecha       timestamptz NOT NULL DEFAULT now(),
  total       numeric(12,2) NOT NULL DEFAULT 0,
  creado_el   timestamptz NOT NULL DEFAULT now()
);

-- Seed: rangos por defecto (editables). Idempotente: no duplica si ya existen.
INSERT INTO rangos_descuento (nombre, porcentaje)
SELECT d.nombre, d.porcentaje
FROM (VALUES
  ('10%', 10),
  ('15%', 15),
  ('20%', 20),
  ('25%', 25),
  ('30%', 30)
) AS d(nombre, porcentaje)
WHERE NOT EXISTS (SELECT 1 FROM rangos_descuento r WHERE r.nombre = d.nombre);
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
-- =============================================================================
-- Fase 0.2 — Endurecimiento de ventas a subdistribuidores
-- =============================================================================
-- UNIQUE sobre clientes.nombre (sin mayúsculas y sin espacios laterales) para
-- impedir clientes duplicados.
-- NOTA: si ya existen clientes con el mismo nombre, esta migración fallará;
-- en ese caso, deduplicar los datos primero y volver a correr.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_nombre_lower
  ON clientes (lower(btrim(nombre)));
