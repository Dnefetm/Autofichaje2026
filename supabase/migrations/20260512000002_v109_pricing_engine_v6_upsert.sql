-- V6 Architecture: UPSERT for Pricing Engine to support partial updates

-- 1. Create precios_proveedor_actual
CREATE TABLE IF NOT EXISTS precios_proveedor_actual (
  proveedor          TEXT NOT NULL,
  codigo             TEXT NOT NULL,
  codigo_barra       TEXT,
  marca              TEXT,
  descripcion        TEXT,
  precio_lista       NUMERIC,
  precio_distribuidor NUMERIC,
  precio_dist_iva    NUMERIC,
  precio_menudeo     NUMERIC,
  precio_mayoreo     NUMERIC,
  precio_subdist     NUMERIC,
  pvl                NUMERIC,
  pp                 NUMERIC,
  importacion_origen UUID REFERENCES importaciones_excel(id),
  fila_raw_origen    UUID REFERENCES listas_precios_raw(id),
  actualizado_el     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (proveedor, codigo)
);

CREATE INDEX IF NOT EXISTS idx_precios_prov_act_proveedor ON precios_proveedor_actual (proveedor);
CREATE INDEX IF NOT EXISTS idx_precios_prov_act_fts ON precios_proveedor_actual USING gin (to_tsvector('simple', codigo||' '||coalesce(descripcion,'')||' '||coalesce(marca,'')));

-- 2. Backfill from the currently active batches in listas_precios_proveedor
INSERT INTO precios_proveedor_actual (
  proveedor, codigo, codigo_barra, marca, descripcion,
  precio_lista, precio_distribuidor, precio_dist_iva,
  precio_menudeo, precio_mayoreo, precio_subdist, pvl, pp,
  importacion_origen, fila_raw_origen, actualizado_el
)
SELECT
  lpp.proveedor,
  lpr.payload->>'CÓDIGO',
  lpr.payload->>'CÓDIGO DE BARRA',
  lpr.payload->>'MARCA',
  lpr.payload->>'DESCRIPCIÓN LARGA',
  NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO DE LISTA', '[^0-9.-]', '', 'g'), '')::numeric,
  NULLIF(REGEXP_REPLACE(lpr.payload->>'P.DIST', '[^0-9.-]', '', 'g'), '')::numeric,
  NULLIF(REGEXP_REPLACE(lpr.payload->>'P.DIST (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
  NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO MENUDEO (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
  NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO MAYORE (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
  NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO SUBDISTRIBUIDOR (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
  NULLIF(REGEXP_REPLACE(lpr.payload->>'PVL', '[^0-9.-]', '', 'g'), '')::numeric,
  NULLIF(REGEXP_REPLACE(lpr.payload->>'PP', '[^0-9.-]', '', 'g'), '')::numeric,
  lpr.importacion_id,
  lpr.id,
  lpp.creado_el AS actualizado_el
FROM listas_precios_raw lpr
JOIN listas_precios_proveedor lpp ON lpp.importacion_id = lpr.importacion_id
WHERE lpp.vigente = true
  AND lpr.payload <> '{}'::jsonb
  AND lpr.payload->>'CÓDIGO' IS NOT NULL
  AND lpr.payload->>'CÓDIGO' != 'CÓDIGO' -- omit headers
  AND lpr.revertido_at IS NULL
ON CONFLICT (proveedor, codigo) DO NOTHING;

-- 3. Redefine the view for the Hub
DROP VIEW IF EXISTS public.v_lista_precios_proveedor CASCADE;
CREATE OR REPLACE VIEW public.v_lista_precios_proveedor AS
SELECT
  proveedor,
  codigo,
  codigo_barra,
  marca,
  descripcion,
  precio_lista,
  precio_distribuidor,
  precio_dist_iva,
  precio_menudeo,
  precio_mayoreo,
  precio_subdist,
  pvl,
  pp,
  importacion_origen,
  fila_raw_origen as id, -- For the frontend which expects an id
  1 as fila_num, -- Dummy value for frontend which orders by fila_num
  actualizado_el
FROM precios_proveedor_actual;

-- 4. Drop the 50% trigger since we now do partial UPSERTs
DROP TRIGGER IF EXISTS trg_protege_lote_vigente ON listas_precios_proveedor;
DROP FUNCTION IF EXISTS fn_trigger_protege_lote_vigente();

-- 5. Rewrite fn_consolidar_revision_importacion
DROP FUNCTION IF EXISTS public.fn_consolidar_revision_importacion(uuid, text);
CREATE OR REPLACE FUNCTION public.fn_consolidar_revision_importacion(p_importacion_id uuid, p_proveedor text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_insertados INT;
  v_actualizados INT;
BEGIN

  WITH upsert AS (
    INSERT INTO precios_proveedor_actual (
      proveedor, codigo, codigo_barra, marca, descripcion,
      precio_lista, precio_distribuidor, precio_dist_iva,
      precio_menudeo, precio_mayoreo, precio_subdist, pvl, pp,
      importacion_origen, fila_raw_origen, actualizado_el
    )
    SELECT
      p_proveedor,
      lpr.payload->>'CÓDIGO',
      lpr.payload->>'CÓDIGO DE BARRA',
      lpr.payload->>'MARCA',
      lpr.payload->>'DESCRIPCIÓN LARGA',
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO DE LISTA', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'P.DIST', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'P.DIST (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO MENUDEO (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO MAYORE (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO SUBDISTRIBUIDOR (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PVL', '[^0-9.-]', '', 'g'), '')::numeric,
      NULLIF(REGEXP_REPLACE(lpr.payload->>'PP', '[^0-9.-]', '', 'g'), '')::numeric,
      p_importacion_id, lpr.id, now()
    FROM listas_precios_raw lpr
    WHERE lpr.importacion_id = p_importacion_id
      AND lpr.payload <> '{}'::jsonb
      AND lpr.payload->>'CÓDIGO' IS NOT NULL
      AND lpr.payload->>'CÓDIGO' != 'CÓDIGO'
      AND lpr.revertido_at IS NULL
    ON CONFLICT (proveedor, codigo) DO UPDATE SET
      codigo_barra       = EXCLUDED.codigo_barra,
      marca              = EXCLUDED.marca,
      descripcion        = EXCLUDED.descripcion,
      precio_lista       = EXCLUDED.precio_lista,
      precio_distribuidor= EXCLUDED.precio_distribuidor,
      precio_dist_iva    = EXCLUDED.precio_dist_iva,
      precio_menudeo     = EXCLUDED.precio_menudeo,
      precio_mayoreo     = EXCLUDED.precio_mayoreo,
      precio_subdist     = EXCLUDED.precio_subdist,
      pvl                = EXCLUDED.pvl,
      pp                 = EXCLUDED.pp,
      importacion_origen = EXCLUDED.importacion_origen,
      fila_raw_origen    = EXCLUDED.fila_raw_origen,
      actualizado_el     = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT
    count(*) FILTER (WHERE inserted) AS insertados,
    count(*) FILTER (WHERE NOT inserted) AS actualizados
  INTO v_insertados, v_actualizados FROM upsert;

  -- Maintain the audit trail and original table sync
  UPDATE listas_precios_proveedor
     SET vigente = false
   WHERE proveedor = p_proveedor
     AND vigente = true
     AND importacion_id IS DISTINCT FROM p_importacion_id;

  INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
  VALUES (p_proveedor, p_importacion_id, true, v_insertados + v_actualizados)
  ON CONFLICT DO NOTHING;

  -- 2) MERGE-SAFE en costos_articulo
  ALTER TABLE costos_articulo DISABLE TRIGGER USER;
  UPDATE costos_articulo ca
     SET vigente=false
   WHERE ca.vigente=true
     AND ca.importacion_id IS DISTINCT FROM p_importacion_id
     AND ca.articulo_id IN (
       SELECT DISTINCT articulo_id
         FROM costos_articulo
        WHERE importacion_id=p_importacion_id
          AND articulo_id IS NOT NULL
     );

  UPDATE costos_articulo
     SET vigente=true
   WHERE importacion_id=p_importacion_id
     AND articulo_id IS NOT NULL;
  ALTER TABLE costos_articulo ENABLE TRIGGER USER;

  UPDATE importaciones_excel SET estado='completado'::estado_importacion_excel, ultima_actividad=now()
   WHERE id = p_importacion_id;

  INSERT INTO importacion_eventos (importacion_id, estado_paso, mensaje)
  VALUES (p_importacion_id, 'CONSOLIDADO', 'Revision finalizada y cambios proyectados al catalogo (V6 UPSERT).');

  RETURN jsonb_build_object('insertados', v_insertados, 'actualizados', v_actualizados);
EXCEPTION WHEN OTHERS THEN
  ALTER TABLE costos_articulo ENABLE TRIGGER USER;
  RAISE;
END;
$function$;
