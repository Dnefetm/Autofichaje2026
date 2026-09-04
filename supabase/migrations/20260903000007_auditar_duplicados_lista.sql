-- =============================================================================
-- MIGRACIÓN (append-only): auditoría de duplicados en la lista de precios
-- =============================================================================
-- Regla de identidad: marca + modelo + EAN (los tres coinciden = mismo producto).
-- Devuelve los grupos con filas repetidas y marca cuándo los precios DIFIEREN
-- (el único caso que importa, porque hoy la dedup "última fila gana" descarta el
-- otro precio en silencio).
--
-- Idempotente (CREATE OR REPLACE). Solo lectura. Reversible (DROP al final).
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_auditar_duplicados_lista(p_importacion_id uuid)
RETURNS TABLE (
    marca text,
    modelo text,
    ean text,
    n_filas bigint,
    precios_distintos boolean,
    precios_dist text
)
LANGUAGE sql
STABLE
AS $$
    WITH filas AS (
        SELECT
            trim(payload->>'MARCA') AS marca,
            COALESCE(trim(payload->>'CLAVE'), trim(payload->>'CÓDIGO')) AS modelo,
            trim(payload->>'CÓDIGO DE BARRA SIN CERO') AS ean,
            trim(payload->>'P.DIST (CON IVA)') AS dist
        FROM listas_precios_raw
        WHERE importacion_id = p_importacion_id
          AND trim(payload->>'CÓDIGO DE BARRA SIN CERO') <> ''
    )
    SELECT
        marca,
        modelo,
        ean,
        count(*) AS n_filas,
        count(DISTINCT dist) > 1 AS precios_distintos,
        string_agg(DISTINCT dist, ' | ') AS precios_dist
    FROM filas
    GROUP BY marca, modelo, ean
    HAVING count(*) > 1
    ORDER BY precios_distintos DESC, marca, modelo, ean;
$$;

COMMIT;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.fn_auditar_duplicados_lista(uuid);
