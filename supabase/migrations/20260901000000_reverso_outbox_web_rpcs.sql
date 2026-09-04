-- ============================================================================
-- CAMINO REVERSO: web -> Supabase -> Sheets
-- Componente SQL: cola de salida (sync_outbox) + RPC de escritura web
-- Modelo de `origin` (3 estados):
--   NULL     = nativo (worker / histórico)  -> NO se encola (no baja a Sheets)
--   'sheets' = escrito por el forward       -> NO se encola (ya vino de Sheets)
--   'web'    = escrito por la web           -> SÍ se encola (baja a Sheets)
-- ============================================================================

-- 1) origin en las tablas que faltan (egresos ya la tiene)
ALTER TABLE ingresos  ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE articulos ADD COLUMN IF NOT EXISTS origin text;

-- 2) cola de salida
CREATE TABLE IF NOT EXISTS sync_outbox (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla      text NOT NULL,                  -- 'articulos' | 'ingresos' | 'egresos'
  clave      text NOT NULL,                  -- articulo_id | ingreso_id | egreso_id
  op         text NOT NULL DEFAULT 'upsert', -- 'upsert' (delete diferido)
  estado     text NOT NULL DEFAULT 'pendiente',
  intentos   int  NOT NULL DEFAULT 0,
  creado_el  timestamptz NOT NULL DEFAULT now(),
  enviado_el timestamptz,
  error      text,
  UNIQUE(tabla, clave)
);

-- 3) trigger de encolado: SOLO cambios origin='web'
CREATE OR REPLACE FUNCTION fn_encolar_sync_outbox()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_clave text;
BEGIN
  -- La clave natural depende de la tabla. No se puede referenciar NEW.<campo>
  -- de otra tabla (daría "record has no field"). Se resuelve con TG_TABLE_NAME.
  IF TG_TABLE_NAME = 'articulos' THEN v_clave := NEW.articulo_id;
  ELSIF TG_TABLE_NAME = 'ingresos' THEN v_clave := NEW.ingreso_id;
  ELSIF TG_TABLE_NAME = 'egresos'  THEN v_clave := NEW.egreso_id;
  ELSE RETURN NULL;
  END IF;

  IF NEW.origin = 'web' AND v_clave IS NOT NULL THEN
    INSERT INTO sync_outbox (tabla, clave, op) VALUES (TG_TABLE_NAME, v_clave, 'upsert')
    ON CONFLICT (tabla, clave) DO UPDATE SET
      op = 'upsert', estado = 'pendiente', intentos = 0, error = NULL, enviado_el = NULL;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_outbox_articulos ON articulos;
CREATE TRIGGER trg_outbox_articulos AFTER INSERT OR UPDATE ON articulos FOR EACH ROW EXECUTE FUNCTION fn_encolar_sync_outbox();
DROP TRIGGER IF EXISTS trg_outbox_ingresos ON ingresos;
CREATE TRIGGER trg_outbox_ingresos AFTER INSERT OR UPDATE ON ingresos FOR EACH ROW EXECUTE FUNCTION fn_encolar_sync_outbox();
DROP TRIGGER IF EXISTS trg_outbox_egresos ON egresos;
CREATE TRIGGER trg_outbox_egresos AFTER INSERT OR UPDATE ON egresos FOR EACH ROW EXECUTE FUNCTION fn_encolar_sync_outbox();

-- 4) RPC de escritura web: origin='web' + guard de clave no vacía + NO escribe sync_hash
CREATE OR REPLACE FUNCTION web_upsert_ingreso(
  p_ingreso_id text, p_articulo_id text, p_cantidad int,
  p_guia text, p_transportista text, p_tipo_ingreso text,
  p_notas text, p_fecha timestamptz, p_operador_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_ingreso_id IS NULL OR btrim(p_ingreso_id) = '' THEN
    RAISE EXCEPTION 'ingreso_id no puede ser vacío';
  END IF;
  INSERT INTO ingresos
    (ingreso_id, articulo_id, cantidad, guia, transportista, tipo_ingreso, notas, fecha, operador_id, origin)
  VALUES
    (p_ingreso_id, p_articulo_id, p_cantidad, p_guia, p_transportista,
     p_tipo_ingreso, p_notas, p_fecha, p_operador_id, 'web')
  ON CONFLICT (ingreso_id) DO UPDATE SET
    articulo_id = EXCLUDED.articulo_id, cantidad = EXCLUDED.cantidad,
    guia = EXCLUDED.guia, transportista = EXCLUDED.transportista,
    tipo_ingreso = EXCLUDED.tipo_ingreso, notas = EXCLUDED.notas,
    fecha = EXCLUDED.fecha, operador_id = EXCLUDED.operador_id,
    origin = 'web';
  -- NO escribe sync_hash: el forward lo pondrá en su próximo ciclo.
  -- El trigger encola el outbox.
END; $$;

CREATE OR REPLACE FUNCTION web_upsert_egreso(
  p_egreso_id text, p_articulo_id text, p_cantidad int,
  p_tipo_egreso text, p_importacion_full_id text,
  p_guia text, p_transportista text, p_operador_id text, p_notas text,
  p_fecha timestamptz,
  p_largo numeric, p_ancho numeric, p_alto numeric, p_peso numeric,
  p_salidas_periodo int, p_codigo_ml text, p_edo_reunido text,
  p_fecha_reunido timestamptz, p_fecha_preparado timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_egreso_id IS NULL OR btrim(p_egreso_id) = '' THEN
    RAISE EXCEPTION 'egreso_id no puede ser vacío';
  END IF;
  INSERT INTO egresos
    (egreso_id, articulo_id, cantidad, tipo_egreso, importacion_full_id,
     guia, transportista, operador_id, notas, fecha,
     largo, ancho, alto, peso, salidas_periodo, codigo_ml,
     edo_reunido, fecha_reunido, fecha_preparado, origin)
  VALUES
    (p_egreso_id, p_articulo_id, p_cantidad, p_tipo_egreso, p_importacion_full_id,
     p_guia, p_transportista, p_operador_id, p_notas, p_fecha,
     p_largo, p_ancho, p_alto, p_peso, p_salidas_periodo, p_codigo_ml,
     p_edo_reunido, p_fecha_reunido, p_fecha_preparado, 'web')
  ON CONFLICT (egreso_id) DO UPDATE SET
    articulo_id = EXCLUDED.articulo_id, cantidad = EXCLUDED.cantidad,
    tipo_egreso = EXCLUDED.tipo_egreso, importacion_full_id = EXCLUDED.importacion_full_id,
    guia = EXCLUDED.guia, transportista = EXCLUDED.transportista,
    operador_id = EXCLUDED.operador_id, notas = EXCLUDED.notas, fecha = EXCLUDED.fecha,
    largo = EXCLUDED.largo, ancho = EXCLUDED.ancho, alto = EXCLUDED.alto, peso = EXCLUDED.peso,
    salidas_periodo = EXCLUDED.salidas_periodo, codigo_ml = EXCLUDED.codigo_ml,
    edo_reunido = EXCLUDED.edo_reunido, fecha_reunido = EXCLUDED.fecha_reunido,
    fecha_preparado = EXCLUDED.fecha_preparado,
    origin = 'web';
END; $$;

-- 5) RPC de escritura web de identidad (articulos)
CREATE OR REPLACE FUNCTION web_upsert_articulo(
  p_articulo_id text, p_nombre text, p_marca text, p_modelo text,
  p_variante text, p_categoria text, p_caja_madre text,
  p_codigo_universal text, p_codigo_sat text, p_url_producto text,
  p_notas text, p_peso_kg numeric, p_es_full boolean, p_es_dropshipping boolean,
  p_descripcion text, p_largo_cm numeric, p_ancho_cm numeric, p_alto_cm numeric,
  p_imagenes text[] DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_articulo_id IS NULL OR btrim(p_articulo_id) = '' THEN
    RAISE EXCEPTION 'articulo_id no puede ser vacío';
  END IF;
  INSERT INTO articulos
    (articulo_id, nombre, marca, modelo, variante, categoria,
     caja_madre, codigo_universal, codigo_sat, url_producto, notas,
     peso_kg, es_full, es_dropshipping, descripcion, largo_cm, ancho_cm, alto_cm, imagenes, origin)
  VALUES
    (p_articulo_id, p_nombre, p_marca, p_modelo, p_variante, p_categoria,
     p_caja_madre, p_codigo_universal, p_codigo_sat, p_url_producto, p_notas,
     p_peso_kg, p_es_full, p_es_dropshipping, p_descripcion, p_largo_cm, p_ancho_cm, p_alto_cm, p_imagenes, 'web')
  ON CONFLICT (articulo_id) DO UPDATE SET
    nombre = EXCLUDED.nombre, marca = EXCLUDED.marca, modelo = EXCLUDED.modelo,
    variante = EXCLUDED.variante, categoria = EXCLUDED.categoria,
    caja_madre = EXCLUDED.caja_madre, codigo_universal = EXCLUDED.codigo_universal,
    codigo_sat = EXCLUDED.codigo_sat, url_producto = EXCLUDED.url_producto,
    notas = EXCLUDED.notas, peso_kg = EXCLUDED.peso_kg,
    es_full = EXCLUDED.es_full, es_dropshipping = EXCLUDED.es_dropshipping,
    descripcion = EXCLUDED.descripcion, largo_cm = EXCLUDED.largo_cm,
    ancho_cm = EXCLUDED.ancho_cm, alto_cm = EXCLUDED.alto_cm, imagenes = COALESCE(EXCLUDED.imagenes, articulos.imagenes),
    origin = 'web';
END; $$;

-- 6) Seguridad: impedir que la key pública (anon/authenticated) llame las RPC de escritura.
--    Por defecto Supabase deja las funciones ejecutables por PUBLIC; al ser SECURITY DEFINER,
--    un anon podría escribir en el inventario. Se revoca y se deja solo service_role.
--    (Mismo patrón que ya usa el proyecto: v115.2_security_and_shim.sql y v100_confirm_rpc.sql)
REVOKE EXECUTE ON FUNCTION public.web_upsert_ingreso   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.web_upsert_egreso    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.web_upsert_articulo  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.web_upsert_ingreso   TO service_role;
GRANT  EXECUTE ON FUNCTION public.web_upsert_egreso    TO service_role;
GRANT  EXECUTE ON FUNCTION public.web_upsert_articulo  TO service_role;
