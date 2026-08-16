-- ---------------------------------------------------------------------
-- 1. Índices Funcionales para el Matching
-- Estos índices pre-calculan la limpieza de strings para que Postgres no lo haga en tiempo de consulta.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_alias_codigo_norm 
ON proveedor_articulos_alias (proveedor, (lower(public.f_unaccent_immutable(trim(codigo_excel)))));

CREATE INDEX IF NOT EXISTS idx_alias_modelo_norm 
ON proveedor_articulos_alias (proveedor, (lower(public.f_unaccent_immutable(trim(modelo_excel)))));

CREATE INDEX IF NOT EXISTS idx_articulos_modelo_norm 
ON articulos ((lower(public.f_unaccent_immutable(trim(modelo)))));


-- ---------------------------------------------------------------------
-- 2. Refactor de fn_resolver_y_poblar_costos (Sin OR)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_resolver_y_poblar_costos(
  p_importacion_id uuid,
  p_proveedor      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '180s'
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

  -- CTE principal
  DROP TABLE IF EXISTS tmp_filas_raw;
  CREATE TEMP TABLE tmp_filas_raw ON COMMIT DROP AS
  SELECT payload, fila_num, 
         lower(public.f_unaccent_immutable(trim(payload->>v_col_modelo))) AS modelo_norm,
         lower(public.f_unaccent_immutable(trim(payload->>v_col_codigo))) AS codigo_norm
  FROM listas_precios_raw
  WHERE importacion_id = p_importacion_id
    AND (COALESCE(payload->>v_col_modelo,'') <> '' OR COALESCE(payload->>v_col_codigo,'') <> '');

  -- --------------------------------------------------------
  -- FASE RESUELTOS (Optimizada separando OR en dos uniones)
  -- --------------------------------------------------------
  WITH alias_match_codigo AS (
    SELECT f.fila_num, a.articulo_id
      FROM tmp_filas_raw f
      JOIN proveedor_articulos_alias a
        ON a.proveedor = p_proveedor
       AND a.articulo_id IS NOT NULL
       AND lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.codigo_norm
       AND f.codigo_norm IS NOT NULL AND f.codigo_norm <> ''
  ),
  alias_match_modelo AS (
    SELECT f.fila_num, a.articulo_id
      FROM tmp_filas_raw f
      JOIN proveedor_articulos_alias a
        ON a.proveedor = p_proveedor
       AND a.articulo_id IS NOT NULL
       AND lower(public.f_unaccent_immutable(trim(a.modelo_excel))) = f.modelo_norm
       AND f.modelo_norm IS NOT NULL AND f.modelo_norm <> ''
  ),
  alias_match AS (
    SELECT fila_num, articulo_id FROM alias_match_codigo
    UNION
    SELECT fila_num, articulo_id FROM alias_match_modelo
  ),
  resueltos AS (
    SELECT f.payload, f.fila_num, am.articulo_id
      FROM tmp_filas_raw f
      LEFT JOIN LATERAL (
        SELECT m.articulo_id FROM alias_match m WHERE m.fila_num = f.fila_num LIMIT 1
      ) am ON true
      WHERE am.articulo_id IS NOT NULL
  ),
  expand AS (
    SELECT r.articulo_id,
           r.payload,
           r.fila_num,
           p->>'columna'                AS precio_col,
           p->>'tipo_costo'             AS tipo_costo,
           (p->>'incluye_iva')::boolean AS incluye_iva
      FROM resueltos r,
           jsonb_array_elements(v_precios) p
  ),
  dedup AS (
    SELECT DISTINCT ON (articulo_id, tipo_costo)
      articulo_id,
      p_importacion_id AS importacion_id,
      payload->>v_col_modelo AS modelo_excel,
      payload->>v_col_marca AS marca_excel,
      payload->>v_col_codigo AS codigo_universal_excel,
      payload->>v_col_desc AS descripcion_excel,
      tipo_costo,
      NULLIF(regexp_replace(COALESCE(payload->>precio_col,'0'),'[^0-9.-]','','g'),'')::numeric AS valor,
      v_moneda AS moneda,
      'excel' AS fuente,
      'confirmado' AS estado_match,
      true AS vigente,
      incluye_iva
    FROM expand e
    WHERE COALESCE(e.payload->>e.precio_col,'') <> ''
      AND NULLIF(regexp_replace(COALESCE(e.payload->>e.precio_col,'0'),'[^0-9.-]','','g'),'')::numeric > 0
    ORDER BY articulo_id, tipo_costo, fila_num DESC
  ),
  upsert_costos AS (
    INSERT INTO costos_articulo (
      articulo_id, importacion_id, modelo_excel, marca_excel,
      codigo_universal_excel, descripcion_excel, tipo_costo,
      valor, moneda, fuente, estado_match, vigente, incluye_iva
    )
    SELECT
      articulo_id, importacion_id, modelo_excel, marca_excel,
      codigo_universal_excel, descripcion_excel, tipo_costo,
      valor, moneda, fuente, estado_match, vigente, incluye_iva
    FROM dedup
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

  -- --------------------------------------------------------
  -- FASE HUÉRFANOS (PENDIENTES) - Optimizada sin OR
  -- --------------------------------------------------------
  WITH huerfanos AS (
    SELECT f.payload, f.fila_num
      FROM tmp_filas_raw f
     WHERE NOT EXISTS (
             SELECT 1 FROM proveedor_articulos_alias a
              WHERE a.proveedor = p_proveedor
                AND a.articulo_id IS NOT NULL
                AND f.codigo_norm IS NOT NULL AND f.codigo_norm <> ''
                AND lower(public.f_unaccent_immutable(trim(a.codigo_excel))) = f.codigo_norm
           )
       AND NOT EXISTS (
             SELECT 1 FROM proveedor_articulos_alias a
              WHERE a.proveedor = p_proveedor
                AND a.articulo_id IS NOT NULL
                AND f.modelo_norm IS NOT NULL AND f.modelo_norm <> ''
                AND lower(public.f_unaccent_immutable(trim(a.modelo_excel))) = f.modelo_norm
           )
       AND NOT EXISTS (
             SELECT 1 FROM articulos ar
              WHERE f.modelo_norm IS NOT NULL AND f.modelo_norm <> ''
                AND lower(public.f_unaccent_immutable(trim(ar.modelo))) = f.modelo_norm
           )
  ),
  expand AS (
    SELECT h.payload,
           h.fila_num,
           p->>'columna'    AS precio_col,
           p->>'tipo_costo' AS tipo_costo
      FROM huerfanos h,
           jsonb_array_elements(v_precios) p
  ),
  dedup_pend AS (
    SELECT DISTINCT ON (COALESCE(payload->>v_col_codigo,''), COALESCE(payload->>v_col_marca,''), COALESCE(payload->>v_col_modelo,''), tipo_costo, importacion_id)
      COALESCE(payload->>v_col_codigo,'') AS codigo_excel,
      COALESCE(payload->>v_col_marca,'') AS marca_excel,
      COALESCE(payload->>v_col_modelo,'') AS modelo_excel,
      tipo_costo,
      NULLIF(regexp_replace(COALESCE(payload->>precio_col,'0'),'[^0-9.-]','','g'),'')::numeric AS valor,
      p_importacion_id AS importacion_id
    FROM expand e
    WHERE COALESCE(e.payload->>e.precio_col,'') <> ''
    ORDER BY COALESCE(payload->>v_col_codigo,''), COALESCE(payload->>v_col_marca,''), COALESCE(payload->>v_col_modelo,''), tipo_costo, importacion_id, fila_num DESC
  ),
  upsert_pend AS (
    INSERT INTO costos_pendientes (
      importacion_id, proveedor, codigo_excel, marca_excel, modelo_excel,
      tipo_costo, moneda, valor, motivo, resuelto
    )
    SELECT
      importacion_id, p_proveedor,
      codigo_excel,
      marca_excel,
      modelo_excel,
      tipo_costo, v_moneda,
      valor,
      'sin_alias_ni_articulo', false
    FROM dedup_pend
    ON CONFLICT (proveedor, COALESCE(codigo_excel,''), COALESCE(marca_excel,''), COALESCE(modelo_excel,''), tipo_costo) WHERE (resuelto = false)
    DO UPDATE SET importacion_id = EXCLUDED.importacion_id, valor = EXCLUDED.valor, moneda = EXCLUDED.moneda, motivo = EXCLUDED.motivo, actualizado_el = now()
    RETURNING modelo_excel
  )
  SELECT count(*), count(DISTINCT modelo_excel)
    INTO v_pendientes, v_modelos_pendientes
    FROM upsert_pend;

  DROP TABLE IF EXISTS tmp_filas_raw;

  RETURN jsonb_build_object(
    'costos_resueltos',    v_resueltos,
    'modelos_resueltos',   v_modelos_resueltos,
    'costos_pendientes',   v_pendientes,
    'modelos_pendientes',  v_modelos_pendientes
  );
END;
$function$;
