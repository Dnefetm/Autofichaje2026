-- =============================================================================
-- MIGRACIÓN (append-only) Capa 0 — parte 3: diff del resumen en SQL
-- =============================================================================
-- Sustituye el cálculo en memoria de resumen/page.tsx (que carga 2 lotes completos)
-- por una función SQL set-based que devuelve los 4 conteos del resumen:
--   nuevos, actualizados, sin_cambio, descontinuados.
--
-- LÓGICA REPRODUCIDA (idéntica a resumen/page.tsx):
--   SKU = CLAVE || CÓDIGO || Codigo
--   comparación de 4 tiers con tolerancia 0.01 (dist, subdist, mayoreo, menudeo)
--   sin lote anterior => todo "nuevo"
--
-- IMPORTANTE: función nueva; no cambia la pantalla actual. Antes de usar, hacer
-- dry-run comparando contra los conteos actuales de resumen/page.tsx.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_resumen_conteo(p_importacion_id uuid)
RETURNS TABLE(nuevos bigint, actualizados bigint, sin_cambio bigint, descontinuados bigint)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
    v_proveedor text;
    v_anterior_id uuid;
    v_nuevos bigint := 0;
    v_actualizados bigint := 0;
    v_sin_cambio bigint := 0;
    v_descontinuados bigint := 0;
BEGIN
    SELECT proveedor INTO v_proveedor FROM importaciones_excel WHERE id = p_importacion_id;
    IF v_proveedor IS NULL THEN
        RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint;
        RETURN;
    END IF;

    SELECT id INTO v_anterior_id FROM importaciones_excel
        WHERE proveedor = v_proveedor AND estado = 'completado' AND id <> p_importacion_id
        ORDER BY creado_el DESC LIMIT 1;

    IF v_anterior_id IS NULL THEN
        SELECT count(*) INTO v_nuevos FROM listas_precios_raw WHERE importacion_id = p_importacion_id;
        RETURN QUERY SELECT v_nuevos, 0::bigint, 0::bigint, 0::bigint;
        RETURN;
    END IF;

    WITH actual AS (
        SELECT
            r.fila_num,
            COALESCE(NULLIF(trim(r.payload->>'CLAVE'), ''), NULLIF(trim(r.payload->>'CÓDIGO'), ''), NULLIF(trim(r.payload->>'Codigo'), ''), '') AS sku,
            COALESCE(NULLIF(regexp_replace(r.payload->>'P.DIST (CON IVA)', '[^0-9.]', '', 'g'), ''), NULLIF(regexp_replace(r.payload->>'P.DIST', '[^0-9.]', '', 'g'), ''), '0')::numeric AS dist,
            COALESCE(NULLIF(regexp_replace(r.payload->>'PRECIO SUBDISTRIBUIDOR (CON IVA)', '[^0-9.]', '', 'g'), ''), '0')::numeric AS subdist,
            COALESCE(NULLIF(regexp_replace(r.payload->>'PRECIO MAYORE (CON IVA)', '[^0-9.]', '', 'g'), ''), '0')::numeric AS mayoreo,
            COALESCE(NULLIF(regexp_replace(r.payload->>'PRECIO MENUDEO (CON IVA)', '[^0-9.]', '', 'g'), ''), '0')::numeric AS menudeo
        FROM listas_precios_raw r
        WHERE r.importacion_id = p_importacion_id
          AND COALESCE(r.payload->>'CLAVE', r.payload->>'CÓDIGO', r.payload->>'Codigo', '') <> ''
    ),
    anterior_dedup AS (
        SELECT DISTINCT ON (sku)
            sku, dist, subdist, mayoreo, menudeo
        FROM (
            SELECT
                COALESCE(NULLIF(trim(r.payload->>'CLAVE'), ''), NULLIF(trim(r.payload->>'CÓDIGO'), ''), NULLIF(trim(r.payload->>'Codigo'), ''), '') AS sku,
                COALESCE(NULLIF(regexp_replace(r.payload->>'P.DIST (CON IVA)', '[^0-9.]', '', 'g'), ''), NULLIF(regexp_replace(r.payload->>'P.DIST', '[^0-9.]', '', 'g'), ''), '0')::numeric AS dist,
                COALESCE(NULLIF(regexp_replace(r.payload->>'PRECIO SUBDISTRIBUIDOR (CON IVA)', '[^0-9.]', '', 'g'), ''), '0')::numeric AS subdist,
                COALESCE(NULLIF(regexp_replace(r.payload->>'PRECIO MAYORE (CON IVA)', '[^0-9.]', '', 'g'), ''), '0')::numeric AS mayoreo,
                COALESCE(NULLIF(regexp_replace(r.payload->>'PRECIO MENUDEO (CON IVA)', '[^0-9.]', '', 'g'), ''), '0')::numeric AS menudeo
            FROM listas_precios_raw r
            WHERE r.importacion_id = v_anterior_id
              AND COALESCE(r.payload->>'CLAVE', r.payload->>'CÓDIGO', r.payload->>'Codigo', '') <> ''
        ) t
        ORDER BY sku
    ),
    clasif AS (
        SELECT
            CASE
                WHEN ant.sku IS NULL THEN 'nuevo'
                WHEN abs(a.dist - ant.dist) > 0.01 OR abs(a.subdist - ant.subdist) > 0.01
                     OR abs(a.mayoreo - ant.mayoreo) > 0.01 OR abs(a.menudeo - ant.menudeo) > 0.01 THEN 'actualizado'
                ELSE 'sin_cambio'
            END AS categoria
        FROM actual a
        LEFT JOIN anterior_dedup ant ON ant.sku = a.sku
    ),
    conteos AS (
        SELECT
            count(*) FILTER (WHERE categoria = 'nuevo') AS nuevos,
            count(*) FILTER (WHERE categoria = 'actualizado') AS actualizados,
            count(*) FILTER (WHERE categoria = 'sin_cambio') AS sin_cambio
        FROM clasif
    ),
    descont AS (
        SELECT count(*) AS n
        FROM anterior_dedup ant
        WHERE NOT EXISTS (SELECT 1 FROM actual a WHERE a.sku = ant.sku)
    )
    SELECT c.nuevos, c.actualizados, c.sin_cambio, d.n
    INTO v_nuevos, v_actualizados, v_sin_cambio, v_descontinuados
    FROM conteos c CROSS JOIN descont d;

    RETURN QUERY SELECT v_nuevos, v_actualizados, v_sin_cambio, v_descontinuados;
END;
$function$;

COMMIT;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.fn_resumen_conteo(uuid);
