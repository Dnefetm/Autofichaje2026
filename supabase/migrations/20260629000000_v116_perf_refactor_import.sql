-- =====================================================================
-- Migración V116: Refactor Set-Based Importación y Precios (Corregida)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. fn_recalcular_lote (Set-Based + ML Queue Preservado)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_lote(p_articulo_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- 1) Costo vigente por artículo (desempate tipo_costo ASC, igual que el loop original)
    CREATE TEMP TABLE tmp_costos ON COMMIT DROP AS
    SELECT DISTINCT ON (articulo_id) articulo_id, valor AS costo
    FROM costos_articulo
    WHERE vigente = true
      AND articulo_id = ANY(p_articulo_ids)
    ORDER BY articulo_id, tipo_costo ASC;

    -- 2) Retenciones agregadas por regla activa (aplana el jsonb una sola vez)
    CREATE TEMP TABLE tmp_reglas ON COMMIT DROP AS
    SELECT r.id, r.canal, r.margen_pct, r.costos_fijos, r.retenciones,
           COALESCE(SUM((e.elem->>'porcentaje')::numeric), 0) AS ret_total
    FROM reglas_precio r
    LEFT JOIN LATERAL (
        SELECT value AS elem
        FROM jsonb_array_elements(r.retenciones)
        WHERE jsonb_typeof(r.retenciones) = 'array'
    ) e ON true
    WHERE r.activa = true
    GROUP BY r.id, r.canal, r.margen_pct, r.costos_fijos, r.retenciones;

    -- 3) Precios nuevos calculados en RAM (cartesiano artículos x reglas)
    CREATE TEMP TABLE tmp_nuevos ON COMMIT DROP AS
    SELECT a.id AS articulo_id,
           rg.canal,
           rg.id AS regla_id,
           round((c.costo + rg.costos_fijos)
                 / (1 - (rg.margen_pct/100.0) - (rg.ret_total/100.0)), 2) AS precio,
           c.costo AS costo_base,
           rg.margen_pct AS margen_aplicado,
           rg.retenciones AS retenciones_aplicadas
    FROM unnest(p_articulo_ids) AS a(id)
    JOIN tmp_costos c ON c.articulo_id = a.id          
    CROSS JOIN tmp_reglas rg
    WHERE (1 - (rg.margen_pct/100.0) - (rg.ret_total/100.0)) > 0;

    -- 4) Detectar cambios de precio en ML ANTES del upsert (para la cola)
    CREATE TEMP TABLE tmp_ml_changed ON COMMIT DROP AS
    SELECT n.articulo_id
    FROM tmp_nuevos n
    LEFT JOIN precios_publicados p
      ON p.articulo_id = n.articulo_id AND p.canal = n.canal
    WHERE n.canal = 'mercadolibre'
      AND (p.precio IS NULL OR p.precio <> n.precio);

    -- 5) Upsert masivo: UNA sola escritura
    INSERT INTO precios_publicados
        (articulo_id, canal, regla_id, precio, costo_base, margen_aplicado, retenciones_aplicadas, calculated_at)
    SELECT articulo_id, canal, regla_id, precio, costo_base, margen_aplicado, retenciones_aplicadas, now()
    FROM tmp_nuevos
    ON CONFLICT (articulo_id, canal) DO UPDATE SET
        regla_id = EXCLUDED.regla_id,
        precio = EXCLUDED.precio,
        costo_base = EXCLUDED.costo_base,
        margen_aplicado = EXCLUDED.margen_aplicado,
        retenciones_aplicadas = EXCLUDED.retenciones_aplicadas,
        calculated_at = now();

    -- 6) Encolar a ML SOLO los que cambiaron (preserva el comportamiento original)
    INSERT INTO ml_publicacion_sync_queue (articulo_id, estado)
    SELECT articulo_id, 'pendiente' FROM tmp_ml_changed
    ON CONFLICT DO NOTHING;
END;
$function$;

-- ---------------------------------------------------------------------
-- 2. fn_preparar_importacion_revision (Set-Based)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_preparar_importacion_revision(
  p_importacion_id uuid,
  p_proveedor      text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_mapeo         jsonb;
    v_col_modelo    text;
    v_modo          text;
    v_importacion_vieja uuid;
    v_nuevos        int := 0;
    v_eliminados    int := 0;
    v_modificados   int := 0;
    v_totales       int := 0;
    v_resultado     jsonb;
BEGIN
    -- 1) Mover de staging a raw
    SELECT COUNT(*) INTO v_totales
      FROM listas_precios_raw_staging
     WHERE importacion_id = p_importacion_id;

    INSERT INTO listas_precios_raw (importacion_id, proveedor, fila_num, payload, columnas_guardadas)
    SELECT importacion_id, proveedor, fila_num, payload, columnas_guardadas
      FROM listas_precios_raw_staging
     WHERE importacion_id = p_importacion_id;

    DELETE FROM listas_precios_raw_staging
     WHERE importacion_id = p_importacion_id;

    -- 2) Leer el modo de carga
    SELECT modo_carga, mapeo_columnas INTO v_modo, v_mapeo
      FROM importaciones_excel
     WHERE id = p_importacion_id;

    v_modo := COALESCE(v_modo, 'parcial');
    v_col_modelo := v_mapeo->>'columna_modelo';

    -- Buscar cuál es el archivo/lista "vigente" actual para comparar
    SELECT importacion_id INTO v_importacion_vieja
      FROM listas_precios_proveedor
     WHERE proveedor = p_proveedor AND vigente = true
     LIMIT 1;

    IF v_col_modelo IS NULL OR v_importacion_vieja IS NULL THEN
        v_nuevos := v_totales;
    ELSE
        -- NUEVO (s) indexado por modelo
        CREATE TEMP TABLE tmp_new ON COMMIT DROP AS
        SELECT (payload->>v_col_modelo) AS modelo, payload
        FROM listas_precios_raw
        WHERE importacion_id = p_importacion_id
          AND (payload->>v_col_modelo) IS NOT NULL;
        CREATE INDEX ON tmp_new (modelo);

        -- VIEJO (o) indexado por modelo
        CREATE TEMP TABLE tmp_old ON COMMIT DROP AS
        SELECT (payload->>v_col_modelo) AS modelo, payload
        FROM listas_precios_raw
        WHERE importacion_id = v_importacion_vieja
          AND (payload->>v_col_modelo) IS NOT NULL;
        CREATE INDEX ON tmp_old (modelo);

        ANALYZE tmp_new;
        ANALYZE tmp_old;

        -- NUEVOS: en tmp_new pero no en tmp_old
        SELECT count(*) INTO v_nuevos
        FROM tmp_new n
        WHERE NOT EXISTS (SELECT 1 FROM tmp_old o WHERE o.modelo = n.modelo);

        -- ELIMINADOS: en tmp_old pero no en tmp_new
        IF v_modo = 'full' THEN
            SELECT count(*) INTO v_eliminados
            FROM tmp_old o
            WHERE NOT EXISTS (SELECT 1 FROM tmp_new n WHERE n.modelo = o.modelo);
        ELSE
            v_eliminados := 0;
        END IF;

        -- MODIFICADOS: mismo modelo, payload distinto (comparación jsonb nativa)
        SELECT count(*) INTO v_modificados
        FROM tmp_new n
        JOIN tmp_old o ON o.modelo = n.modelo
        WHERE n.payload <> o.payload;
    END IF;

    -- Full mode: marcar vieja no vigente + alta nueva
    IF v_modo = 'full' THEN
        BEGIN
          ALTER TABLE listas_precios_proveedor DISABLE TRIGGER USER;
          UPDATE listas_precios_proveedor SET vigente = false
           WHERE proveedor = p_proveedor AND vigente = true;
          INSERT INTO listas_precios_proveedor (proveedor, importacion_id, vigente, total_filas)
          VALUES (p_proveedor, p_importacion_id, true, v_totales);
          ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
        EXCEPTION WHEN OTHERS THEN
          ALTER TABLE listas_precios_proveedor ENABLE TRIGGER USER;
          RAISE;
        END;
    END IF;

    -- 3) Resolver Costos y Poblarlos
    v_resultado := public.fn_resolver_y_poblar_costos(p_importacion_id, p_proveedor);

    -- Resumen diff + estado en_revision
    UPDATE importaciones_excel
       SET resumen_diff = jsonb_build_object(
               'totales', v_totales,
               'nuevos', v_nuevos,
               'eliminados', v_eliminados,
               'modificados', v_modificados),
           estado = 'en_revision'
     WHERE id = p_importacion_id;
END;
$function$;

-- ---------------------------------------------------------------------
-- 3. Crear índice para optimizar cruces adicionales
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lpr_importacion ON listas_precios_raw (importacion_id);
