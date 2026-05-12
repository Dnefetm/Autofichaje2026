-- 1. Crear índices de rendimiento en listas_precios_raw
CREATE INDEX IF NOT EXISTS idx_raw_importacion_fila ON listas_precios_raw(importacion_id, fila_num);
CREATE INDEX IF NOT EXISTS idx_raw_payload_gin ON listas_precios_raw USING GIN (payload jsonb_path_ops);

-- 2. Crear nueva vista para el hub de precios que lee directo del Excel (payload)
DROP VIEW IF EXISTS public.v_lista_precios_proveedor CASCADE;
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
    NULLIF(TRIM(REPLACE(lpr.payload->>'PRECIO DE LISTA', ',', '')), '')::numeric AS precio_lista,
    NULLIF(TRIM(REPLACE(lpr.payload->>'P.DIST', ',', '')), '')::numeric AS precio_distribuidor,
    NULLIF(TRIM(REPLACE(lpr.payload->>'P.DIST (CON IVA)', ',', '')), '')::numeric AS precio_distribuidor_iva,
    NULLIF(TRIM(REPLACE(lpr.payload->>'PRECIO SUBDISTRIBUIDOR (CON IVA)', ',', '')), '')::numeric AS precio_subdistribuidor,
    NULLIF(TRIM(REPLACE(lpr.payload->>'PRECIO MAYORE (CON IVA)', ',', '')), '')::numeric AS precio_mayoreo,
    NULLIF(TRIM(REPLACE(lpr.payload->>'PRECIO MENUDEO (CON IVA)', ',', '')), '')::numeric AS precio_menudeo,
    NULLIF(TRIM(REPLACE(lpr.payload->>'PVL', ',', '')), '')::numeric AS pvl,
    NULLIF(TRIM(REPLACE(lpr.payload->>'PP', ',', '')), '')::numeric AS pp
FROM listas_precios_raw lpr
JOIN lote_vigente lv ON lv.importacion_id = lpr.importacion_id
WHERE lpr.revertido_at IS NULL
  AND lpr.payload <> '{}'::jsonb;

-- 3. Trigger protector de lote vigente (bloquea tests < 50% de promover a canónico)
CREATE OR REPLACE FUNCTION fn_trigger_protege_lote_vigente()
RETURNS TRIGGER AS $$
DECLARE
    v_total_actual INT;
BEGIN
    IF NEW.vigente = true AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.vigente = false)) THEN
        
        IF NEW.total_filas IS NULL THEN
            RAISE EXCEPTION 'Protección de lote: total_filas no puede ser NULL al marcar vigente';
        END IF;

        -- FOR UPDATE bloquea la fila del lote vigente actual para evitar condiciones de carrera (concurrencia)
        SELECT total_filas INTO v_total_actual 
        FROM listas_precios_proveedor 
        WHERE proveedor = NEW.proveedor AND vigente = true
        FOR UPDATE LIMIT 1;
        
        IF v_total_actual IS NOT NULL AND NEW.total_filas < (v_total_actual * 0.5) THEN
            RAISE EXCEPTION 'Protección de lote: El nuevo lote (%) tiene menos del 50%% de las filas del lote vigente (%)', NEW.total_filas, v_total_actual;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protege_lote_vigente ON listas_precios_proveedor;
CREATE TRIGGER trg_protege_lote_vigente
BEFORE INSERT OR UPDATE OF vigente ON listas_precios_proveedor
FOR EACH ROW EXECUTE FUNCTION fn_trigger_protege_lote_vigente();

-- 4. Reforzar vista antigua para otros consumidores
DROP VIEW IF EXISTS public.v_precio_vigente_sku CASCADE;
CREATE OR REPLACE VIEW v_precio_vigente_sku AS
WITH lote_vigente AS (
    SELECT proveedor, importacion_id
    FROM listas_precios_proveedor
    WHERE vigente = true
)
SELECT DISTINCT ON (ie.proveedor, ca.articulo_id, ca.tipo_costo) 
    ie.proveedor,
    a.codigo_universal,
    a.marca,
    a.modelo,
    a.nombre,
    ca.valor AS precio,
    ca.moneda,
    ca.tipo_costo,
    ca.articulo_id,
    ca.actualizado_el AS fecha_ultima_actualizacion,
    0 AS dias_desde_actualizacion,
    true AS presente_en_ultima_lista,
    'vigente'::text AS estado_actualizacion
FROM costos_articulo ca
JOIN importaciones_excel ie ON ie.id = ca.importacion_id
LEFT JOIN articulos a ON a.articulo_id = ca.articulo_id
JOIN lote_vigente lv ON lv.proveedor = ie.proveedor
WHERE ie.estado = 'completado'::estado_importacion_excel 
  AND ca.articulo_id IS NOT NULL
  AND ca.importacion_id = lv.importacion_id;
