-- Migración: stock por estado (dañados / devoluciones) — Tarea 3
-- ADITIVA: agrega columnas + extiende el CHECK de tipo_egreso + función de traspaso.
-- No toca datos existentes. Idempotente.

-- 1) Contadores de stock no-vendible (tracking; el vendible sigue siendo physical_stock)
ALTER TABLE public.articulos
  ADD COLUMN IF NOT EXISTS danados INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS devoluciones INTEGER NOT NULL DEFAULT 0;

-- 2) Extender CHECK de tipo_egreso (mantiene los 4 actuales + agrega 2)
--    Valores actuales confirmados: venta, envio_full, otro, devolucion_proveedor.
ALTER TABLE public.egresos DROP CONSTRAINT IF EXISTS chk_tipo_egreso;
ALTER TABLE public.egresos ADD CONSTRAINT chk_tipo_egreso
  CHECK (tipo_egreso IN ('venta','envio_full','otro','devolucion_proveedor','danado','devolucion'));

-- 3) Traspaso atómico de stock
--    El INSERT de egreso dispara fn_recalcular_stock → baja physical_stock (lo saca de venta).
--    El UPDATE del contador solo hace tracking (no vuelve a tocar physical_stock).
CREATE OR REPLACE FUNCTION public.fn_traspaso_stock(
  p_articulo_id text,
  p_cantidad integer,
  p_estado text,     -- 'danado' | 'devolucion' | 'desecho' | 'devolver'
  p_ubicacion text   -- caja destino (ej. 'CAJA DAÑADOS')
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_cantidad <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a 0';
  END IF;

  IF p_estado = 'danado' THEN
    INSERT INTO egresos (articulo_id, cantidad, tipo_egreso, notas)
      VALUES (p_articulo_id, p_cantidad, 'danado', 'Traspaso a dañados: ' || COALESCE(p_ubicacion,''));
    UPDATE articulos SET danados = danados + p_cantidad WHERE articulo_id = p_articulo_id;

  ELSIF p_estado = 'devolucion' THEN
    INSERT INTO egresos (articulo_id, cantidad, tipo_egreso, notas)
      VALUES (p_articulo_id, p_cantidad, 'devolucion', 'Traspaso a devoluciones: ' || COALESCE(p_ubicacion,''));
    UPDATE articulos SET devoluciones = devoluciones + p_cantidad WHERE articulo_id = p_articulo_id;

  ELSIF p_estado = 'desecho' THEN
    UPDATE articulos SET danados = GREATEST(0, danados - p_cantidad) WHERE articulo_id = p_articulo_id;

  ELSIF p_estado = 'devolver' THEN
    UPDATE articulos SET devoluciones = GREATEST(0, devoluciones - p_cantidad) WHERE articulo_id = p_articulo_id;

  ELSE
    RAISE EXCEPTION 'Estado inválido: %', p_estado;
  END IF;
END;
$$;
