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
