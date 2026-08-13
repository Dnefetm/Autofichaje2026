BEGIN;

-- Nota: se usa el índice único existente ux_costos_articulo_key(articulo_id, tipo_costo, fuente)
-- para el ON CONFLICT. No se crean nuevos índices porque el esquema ya provee la clave lógica.

CREATE OR REPLACE FUNCTION public.fn_drain_costos_pendientes_sin_match()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row      record;
  v_articulo record;
BEGIN
  FOR v_row IN
    SELECT
      cp.id,
      cp.importacion_id,
      cp.proveedor,
      cp.codigo_excel,
      cp.marca_excel,
      cp.modelo_excel,
      cp.tipo_costo,
      cp.valor,
      cp.moneda,
      alias.articulo_id
    FROM costos_pendientes cp
    JOIN proveedor_articulos_alias alias
      ON alias.proveedor = cp.proveedor
     AND (
          (cp.codigo_excel IS NOT NULL AND cp.codigo_excel <> ''
             AND alias.codigo_excel = cp.codigo_excel)
       OR ((cp.codigo_excel IS NULL OR cp.codigo_excel = '')
             AND alias.marca_excel  = cp.marca_excel
             AND alias.modelo_excel = cp.modelo_excel)
     )
    WHERE cp.motivo   = 'sin_match'
      AND cp.resuelto = false
  LOOP
    -- 1) Propagar a duplicados por GTIN + al propio articulo_id
    FOR v_articulo IN
      WITH target AS (
        SELECT codigo_universal
        FROM articulos
        WHERE articulo_id = v_row.articulo_id
      )
      SELECT a.articulo_id
      FROM articulos a
      JOIN target t
        ON a.codigo_universal = t.codigo_universal
      WHERE a.codigo_universal IS NOT NULL
        AND a.codigo_universal <> ''
      UNION
      SELECT v_row.articulo_id
    LOOP
      -- 2) Insertar/actualizar costos_articulo (ON CONFLICT sobre ux_costos_articulo_key)
      INSERT INTO costos_articulo (
        importacion_id,
        articulo_id,
        modelo_excel,
        marca_excel,
        codigo_universal_excel,
        tipo_costo,
        valor,
        moneda,
        fuente,
        estado_match,
        vigente
      )
      VALUES (
        v_row.importacion_id,
        v_articulo.articulo_id,
        v_row.modelo_excel,
        v_row.marca_excel,
        v_row.codigo_excel,
        v_row.tipo_costo,
        v_row.valor,
        v_row.moneda,
        'excel',
        'completado',
        true
      )
      ON CONFLICT (articulo_id, tipo_costo, fuente)
      DO UPDATE SET
        importacion_id         = EXCLUDED.importacion_id,
        modelo_excel           = EXCLUDED.modelo_excel,
        marca_excel            = EXCLUDED.marca_excel,
        codigo_universal_excel = EXCLUDED.codigo_universal_excel,
        valor                  = EXCLUDED.valor,
        moneda                 = EXCLUDED.moneda,
        vigente                = true,
        estado_match           = 'completado',
        actualizado_el         = now();

      -- 3) Encolar recomputo de pricing
      INSERT INTO jobs (type, payload, priority, status)
      VALUES (
        'recalc_pricing_bundle',
        jsonb_build_object('articulo_id', v_articulo.articulo_id),
        3,
        'pending'
      );
    END LOOP;

    -- 4) Marcar pendiente como resuelto (columnas reales)
    UPDATE costos_pendientes
       SET resuelto = true
     WHERE id = v_row.id;
  END LOOP;
END;
$$;

-- Habilitar cron (ejecutar como superuser tras validar en staging):
-- SELECT cron.schedule(
--   'drain_costos_15min',
--   '*/15 * * * *',
--   $$SELECT public.fn_drain_costos_pendientes_sin_match()$$
-- );

COMMIT;
