CREATE OR REPLACE VIEW public.v_lista_precios_proveedor AS
WITH lote_vigente AS (
    SELECT importacion_id, proveedor 
    FROM listas_precios_proveedor 
    WHERE vigente = true
)
SELECT
    lpr.id,
    lpr.importacion_id,
    lpr.proveedor,
    lpr.fila_num,
    lpr.payload->>'CÓDIGO' AS codigo,
    lpr.payload->>'CÓDIGO DE BARRA' AS codigo_barra,
    lpr.payload->>'MARCA' AS marca,
    lpr.payload->>'DESCRIPCIÓN LARGA' AS descripcion,
    NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO DE LISTA', '[^0-9.-]', '', 'g'), '')::numeric AS precio_lista,
    NULLIF(REGEXP_REPLACE(lpr.payload->>'P.DIST', '[^0-9.-]', '', 'g'), '')::numeric AS precio_distribuidor,
    NULLIF(REGEXP_REPLACE(lpr.payload->>'P.DIST (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric AS precio_distribuidor_iva,
    NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO SUBDISTRIBUIDOR (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric AS precio_subdistribuidor,
    NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO MAYORE (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric AS precio_mayoreo,
    NULLIF(REGEXP_REPLACE(lpr.payload->>'PRECIO MENUDEO (CON IVA)', '[^0-9.-]', '', 'g'), '')::numeric AS precio_menudeo,
    NULLIF(REGEXP_REPLACE(lpr.payload->>'PVL', '[^0-9.-]', '', 'g'), '')::numeric AS pvl,
    NULLIF(REGEXP_REPLACE(lpr.payload->>'PP', '[^0-9.-]', '', 'g'), '')::numeric AS pp
FROM listas_precios_raw lpr
JOIN lote_vigente lv ON lv.importacion_id = lpr.importacion_id
WHERE lpr.revertido_at IS NULL
  AND lpr.payload <> '{}'::jsonb
  AND lpr.payload->>'CÓDIGO' != 'CÓDIGO'; -- Filtrar la fila de encabezado explícitamente por si acaso
