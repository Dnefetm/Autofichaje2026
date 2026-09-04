-- =============================================================================
-- MIGRACIÓN (append-only): corrige la auditoría de duplicados
-- =============================================================================
-- Corrige la versión 0007: compara LOS 4 tiers (dist, subdist, mayoreo, menudeo),
-- no solo P.DIST. Regla de identidad: marca + modelo + EAN (los tres, como pediste).
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_auditar_duplicados_lista(p_importacion_id uuid)
RETURNS TABLE (
    marca text,
    modelo text,
    ean text,
    n_filas bigint,
    precios_distintos boolean,
    detalle text
)
LANGUAGE sql
STABLE
AS $$
    WITH filas AS (
        SELECT
            trim(payload->>'MARCA') AS marca,
            COALESCE(trim(payload->>'CLAVE'), trim(payload->>'CÓDIGO')) AS modelo,
            trim(payload->>'CÓDIGO DE BARRA SIN CERO') AS ean,
            trim(payload->>'P.DIST (CON IVA)') AS dist,
            trim(payload->>'PRECIO SUBDISTRIBUIDOR (CON IVA)') AS subdist,
            trim(payload->>'PRECIO MAYORE (CON IVA)') AS mayoreo,
            trim(payload->>'PRECIO MENUDEO (CON IVA)') AS menudeo
        FROM listas_precios_raw
        WHERE importacion_id = p_importacion_id
          AND trim(payload->>'CÓDIGO DE BARRA SIN CERO') <> ''
    )
    SELECT
        marca,
        modelo,
        ean,
        count(*) AS n_filas,
        (count(DISTINCT dist) > 1 OR count(DISTINCT subdist) > 1
         OR count(DISTINCT mayoreo) > 1 OR count(DISTINCT menudeo) > 1) AS precios_distintos,
        string_agg(DISTINCT 'dist='||dist||' sub='||subdist||' may='||mayoreo||' men='||menudeo, ' | ') AS detalle
    FROM filas
    GROUP BY marca, modelo, ean
    HAVING count(*) > 1
    ORDER BY precios_distintos DESC, marca, modelo, ean;
$$;

COMMIT;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.fn_auditar_duplicados_lista(uuid);
