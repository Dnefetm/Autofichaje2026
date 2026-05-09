-- Migration: v86_resumen_diff_resolver_costos
-- Fecha: 2026-05-09
-- Proposito:
--   1) Crear public.fn_resolver_y_poblar_costos: resuelve filas de listas_precios_raw
--      via proveedor_articulos_alias y puebla costos_articulo (resueltos)
--      y costos_pendientes (huerfanos), con UPSERT sobre constraints unicos.
--   2) Reemplazar public.fn_preparar_importacion_revision para que invoque al
--      resolver y escriba un resumen_diff compatible con la UI antigua
--      (nuevos/modificados/eliminados) y la UI nueva
--      (modelos_resueltos/modelos_pendientes/costos_actualizados/costos_pendientes).
--
-- Estado previo: la UI mostraba 0/0/0 porque resumen_diff usaba claves nuevas
-- que el frontend no consumia y los costos no se poblaban automaticamente.
--
-- Estado posterior: import termina en 'en_revision' con contadores correctos
-- y costos_articulo/costos_pendientes poblados sin SQL manual.

-- =====================================================================
-- 1) fn_resolver_y_poblar_costos
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_resolver_y_poblar_costos(
  p_importacion_id uuid,
  p_proveedor      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_mapeo               jsonb;
  v_col_modelo          text;
  v_col_codigo          text;
  v_col_marca           text;
  v_col_desc            text;
  v_moneda              text;
  v_precios             jsonb;
  v_resueltos           int := 0;
  v_pendientes          int := 0;
  v_modelos_resueltos   int := 0;
  v_modelos_pendientes  int := 0;
BEGIN
  SELECT mapeo_columnas INTO v_mapeo
    FROM importaciones_excel
   WHERE id = p_importacion_id;

  v_col_modelo := v_mapeo->>'columna_modelo';
  v_col_codigo := v_mapeo->>'columna_codigo';
  v_col_marca  := v_mapeo->>'columna_marca';
  v_col_desc   := v_mapeo->>'columna_descripcion';
  v_moneda     := COALESCE(v_mapeo->>'moneda_default','MXN');
  v_precios    := v_mapeo->'precios';

  WITH filas AS (
    SELECT r.payload
      FROM listas_precios_raw r
     WHERE r.importacion_id = p_importacion_id
       AND COALESCE(r.payload->>v_col_modelo,'') <> ''
  ),
  resueltos AS (
    SELECT f.payload,
           (
             SELECT a.articulo_id
               FROM proveedor_articulos_alias a
              WHERE a.proveedor   = p_proveedor
                AND a.articulo_id IS NOT NULL
                AND ( lower(unaccent(trim(a.codigo_excel))) = lower(unaccent(trim(f.payload->>v_col_modelo)))
                   OR lower(unaccent(trim(a.modelo_excel))) = lower(unaccent(trim(f.payload->>v_col_modelo))) )
              LIMIT 1
           ) AS articulo_id
      FROM filas f
  ),
  expand AS (
    SELECT r.articulo_id,
           r.payload,
           p->>'columna'                AS precio_col,
           p->>'tipo_costo'             AS tipo_costo,
           (p->>'incluye_iva')::boolean AS incluye_iva
      FROM resueltos r,
           jsonb_array_elements(v_precios) p
     WHERE r.articulo_id IS NOT NULL
  ),
  upsert_costos AS (
    INSERT INTO costos_articulo (
      articulo_id, importacion_id, modelo_excel, marca_excel,
      codigo_universal_excel, descripcion_excel, tipo_costo,
      valor, moneda, fuente, estado_match, vigente, incluye_iva
    )
    SELECT
      e.articulo_id, p_importacion_id,
      e.payload->>v_col_modelo,
      e.payload->>v_col_marca,
      e.payload->>v_col_codigo,
      e.payload->>v_col_desc,
      e.tipo_costo,
      NULLIF(regexp_replace(COALESCE(e.payload->>e.precio_col,'0'),'[^0-9.-]','','g'),'')::numeric,
      v_moneda, 'excel', 'confirmado', true, e.incluye_iva
    FROM expand e
    WHERE COALESCE(e.payload->>e.precio_col,'') <> ''
      AND NULLIF(regexp_replace(COALESCE(e.payload->>e.precio_col,'0'),'[^0-9.-]','','g'),'')::numeric > 0
    ON CONFLICT (articulo_id, tipo_costo, fuente) DO UPDATE SET
      importacion_id          = EXCLUDED.importacion_id,
      valor                   = EXCLUDED.valor,
      moneda                  = EXCLUDED.moneda,
      modelo_excel            = EXCLUDED.modelo_excel,
      marca_excel             = EXCLUDED.marca_excel,
      codigo_universal_excel  = EXCLUDED.codigo_universal_excel,
      descripcion_excel       = EXCLUDED.descripcion_excel,
      estado_match            = 'confirmado',
      vigente                 = true,
      incluye_iva             = EXCLUDED.incluye_iva,
      actualizado_el          = now()
    RETURNING articulo_id
  )
  SELECT count(*), count(DISTINCT articulo_id)
    INTO v_resueltos, v_modelos_resueltos
    FROM upsert_costos;

  WITH filas AS (
    SELECT r.payload
      FROM listas_precios_raw r
     WHERE r.importacion_id = p_importacion_id
       AND COALESCE(r.payload->>v_col_modelo,'') <> ''
  ),
  huerfanos AS (
    SELECT f.payload
      FROM filas f
     WHERE NOT EXISTS (
             SELECT 1 FROM proveedor_articulos_alias a
              WHERE a.proveedor   = p_proveedor
                AND a.articulo_id IS NOT NULL
                AND ( lower(unaccent(trim(a.codigo_excel))) = lower(unaccent(trim(f.payload->>v_col_modelo)))
                   OR lower(unaccent(trim(a.modelo_excel))) = lower(unaccent(trim(f.payload->>v_col_modelo))) )
           )
       AND NOT EXISTS (
             SELECT 1 FROM articulos ar
              WHERE lower(unaccent(trim(ar.modelo))) = lower(unaccent(trim(f.payload->>v_col_modelo)))
           )
  ),
  expand AS (
    SELECT h.payload,
           p->>'columna'    AS precio_col,
           p->>'tipo_costo' AS tipo_costo
      FROM huerfanos h,
           jsonb_array_elements(v_precios) p
  ),
  upsert_pend AS (
    INSERT INTO costos_pendientes (
      importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel,
      tipo_costo, moneda, valor, motivo, resuelto
    )
    SELECT
      p_importacion_id, p_proveedor,
      COALESCE(e.payload->>v_col_codigo,''),
      COALESCE(e.payload->>v_col_marca,''),
      COALESCE(e.payload->>v_col_modelo,''),
      e.tipo_costo, v_moneda,
      NULLIF(regexp_replace(COALESCE(e.payload->>e.precio_col,'0'),'[^0-9.-]','','g'),'')::numeric,
      'sin_alias_ni_articulo', false
    FROM expand e
    WHERE COALESCE(e.payload->>e.precio_col,'') <> ''
    ON CONFLICT (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo)
      WHERE (resuelto = false)
    DO UPDATE SET
      importacion_id = EXCLUDED.importacion_id,
      valor          = EXCLUDED.valor,
      moneda         = EXCLUDED.moneda,
      motivo         = EXCLUDED.motivo,
      actualizado_el = now()
    RETURNING modelo_excel
  )
  SELECT count(*), count(DISTINCT modelo_excel)
    INTO v_pendientes, v_modelos_pendientes
    FROM upsert_pend;

  RETURN jsonb_build_object(
    'costos_resueltos',    v_resueltos,
    'modelos_resueltos',   v_modelos_resueltos,
    'costos_pendientes',   v_pendientes,
    'modelos_pendientes',  v_modelos_pendientes
  );
END;
$function$;

-- =====================================================================
-- 2) fn_preparar_importacion_revision (reemplazo)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fn_preparar_importacion_revision(
  p_importacion_id uuid,
  p_proveedor      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_totales              int := 0;
  v_resultado            jsonb;
  v_modelos_resueltos    int := 0;
  v_modelos_pendientes   int := 0;
BEGIN
  SELECT COUNT(*) INTO v_totales
    FROM listas_precios_raw_staging
   WHERE importacion_id = p_importacion_id;

  INSERT INTO listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
  SELECT importacion_id, proveedor, fila_num, payload, columnas_guardadas
    FROM listas_precios_raw_staging
   WHERE importacion_id = p_importacion_id;

  DELETE FROM listas_precios_raw_staging
   WHERE importacion_id = p_importacion_id;

  BEGIN
    ALTER TABLE listas_precios_proveedor DISABLE TRIGGER USER;
    UPDATE listas_precios_proveedor
       SET vigente = false
     WHERE proveedor = p_proveedor AND vigente = true;
    INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
    VALUES (p_proveedor, p_importacion_id, true, v_totales);
    ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
    RAISE;
  END;

  v_resultado          := public.fn_resolver_y_poblar_costos(p_importacion_id, p_proveedor);
  v_modelos_resueltos  := COALESCE((v_resultado->>'modelos_resueltos')::int, 0);
  v_modelos_pendientes := COALESCE((v_resultado->>'modelos_pendientes')::int, 0);

  UPDATE importaciones_excel
     SET resumen_diff = jsonb_build_object(
           'totales',              v_totales,
           'nuevos',               v_modelos_pendientes,
           'modificados',          v_modelos_resueltos,
           'eliminados',           0,
           'modelos_resueltos',    v_modelos_resueltos,
           'modelos_pendientes',   v_modelos_pendientes,
           'costos_actualizados',  COALESCE((v_resultado->>'costos_resueltos')::int, 0),
           'costos_pendientes',    COALESCE((v_resultado->>'costos_pendientes')::int, 0)
         ),
         estado            = 'en_revision'::estado_importacion_excel,
         ultima_actividad  = now()
   WHERE id = p_importacion_id;

  INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
  VALUES (
    p_importacion_id, 'CONSOLIDADO',
    format('Resueltos %s modelos / Pendientes %s modelos', v_modelos_resueltos, v_modelos_pendientes)
  );
END;
$function$;
