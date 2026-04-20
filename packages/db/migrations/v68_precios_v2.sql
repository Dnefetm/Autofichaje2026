-- =============================================================================
-- MIGRACIÓN v68: Módulo Importación de Precios V2 (Fase 0 - Arquitectura ERP)
-- Autor: Antigravity
-- =============================================================================

BEGIN;

-- 1. Instalar unaccent si no existe para búsquedas case-insensitive / accent-insensitive
CREATE EXTENSION IF NOT EXISTS unaccent;

-- 2. Crear índices funcionales para evitar seq scans masivos al verificar catálogos
CREATE INDEX IF NOT EXISTS idx_articulos_marca_norm ON articulos (lower(unaccent(trim(marca))));
CREATE INDEX IF NOT EXISTS idx_articulos_modelo_norm ON articulos (lower(unaccent(trim(modelo))));
CREATE INDEX IF NOT EXISTS idx_articulos_codigo_norm ON articulos (lower(unaccent(trim(codigo_universal))));

-- 3. Crear Enums de estado_match.
-- Actualmente estado_match es texto, agregamos CHECK para validar la jerarquía de ERP
ALTER TABLE costos_articulo DROP CONSTRAINT IF EXISTS chk_costos_articulo_estado_match;
-- NOTA: agregamos los valores viejos (sugerido, confirmado, etc) para no romper imports atascados,
-- pero agregamos los nuevos niveles exactos y el descontinuado_por_proveedor.
ALTER TABLE costos_articulo ADD CONSTRAINT chk_costos_articulo_estado_match 
  CHECK (estado_match IN (
    -- Legacy / Compatibilidad
    'sin_match', 'sugerido', 'confirmado', 'rechazado',
    -- Nuevos niveles jerárquicos
    'actualizado_fuerte', 'cambio_codigo_sugerido', 'ambiguo', 'nuevo',
    -- Control ERP
    'descontinuado_por_proveedor'
  ));

-- 4. Crear tabla de auditoría para cambios críticos (como modificar base de datos articulos)
CREATE TABLE IF NOT EXISTS public.auditoria_cambios_codigo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  articulo_id text NOT NULL REFERENCES public.articulos(articulo_id) ON DELETE CASCADE,
  codigo_anterior text,
  codigo_nuevo    text,
  marca           text,
  modelo          text,
  proveedor       text,
  importacion_id  uuid REFERENCES public.importaciones_excel(id) ON DELETE SET NULL,
  usuario         uuid,  -- User that approved the change
  creado_el       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_cambios_codigo_articulo ON public.auditoria_cambios_codigo (articulo_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_cambios_codigo_importacion ON public.auditoria_cambios_codigo (importacion_id);

-- Habilitar RLS en tabla de auditoria
ALTER TABLE public.auditoria_cambios_codigo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Lectura administradores auditoria" ON public.auditoria_cambios_codigo FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Insert administradores auditoria" ON public.auditoria_cambios_codigo FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 5. Refactorizar fn_match_articulo_proveedor 
-- (Conservamos la forma pero convertimos fuzz a unaccent estricto)
DROP FUNCTION IF EXISTS fn_match_articulo_proveedor(text, text, text);

CREATE OR REPLACE FUNCTION fn_match_articulo_proveedor(
    p_modelo  text,
    p_marca   text DEFAULT NULL,
    p_codigo  text DEFAULT NULL
)
RETURNS TABLE (
    articulo_id      text,
    nombre           text,
    marca            text,
    modelo           text,
    codigo_universal text,
    caja_madre       text,
    puntaje_match    numeric,
    metodo_match     text,      -- Retiene propósitos legacy UI ('codigo_exacto', 'fuzzy_trgm')
    nivel_match      text       -- NUEVA COLUMNA ESTRESANTE: 'actualizado_fuerte', 'cambio_codigo_sugerido', 'ambiguo', 'ambiguo_medio', 'nuevo'
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_norm_marca text;
    v_norm_modelo text;
    v_norm_codigo text;
BEGIN
    -- Normalizar inputs
    v_norm_marca  := lower(unaccent(trim(p_marca)));
    v_norm_modelo := lower(unaccent(trim(p_modelo)));
    v_norm_codigo := lower(unaccent(trim(p_codigo)));

    -- ── NIVEL 1: FUERTE (Identidad plena si todos los campos cruzan) ──
    IF v_norm_codigo IS NOT NULL AND v_norm_codigo != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            a.codigo_universal::text,
            a.caja_madre::text,
            100::numeric AS puntaje_match,
            'codigo_exacto'::text AS metodo_match,
            'actualizado_fuerte'::text AS nivel_match
        FROM articulos a
        WHERE a.activo = true
          AND lower(unaccent(trim(a.codigo_universal))) = v_norm_codigo
          AND lower(unaccent(trim(a.marca))) = v_norm_marca
          AND lower(unaccent(trim(a.modelo))) = v_norm_modelo
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    -- ── NIVEL 2: MEDIO (Cambio de código sugerido - Cruzan marca y modelo, no el código) ──
    IF v_norm_marca IS NOT NULL AND v_norm_marca != '' AND v_norm_modelo IS NOT NULL AND v_norm_modelo != '' THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            a.codigo_universal::text,
            a.caja_madre::text,
            85::numeric AS puntaje_match,
            'marca_modelo_exacto'::text AS metodo_match,
            'cambio_codigo_sugerido'::text AS nivel_match
        FROM articulos a
        WHERE a.activo = true
          AND lower(unaccent(trim(a.marca))) = v_norm_marca
          AND lower(unaccent(trim(a.modelo))) = v_norm_modelo
        LIMIT 5;

        IF FOUND THEN RETURN; END IF;
    END IF;

    -- ── NIVEL 3: FALLBACK A FUZZY (Legacy - Conservamos la naturaleza para que la UI no se vacíe si hay errores de tipeo)
    -- Si el proveedor manda basura como `Kit Herramntas`, el fuzzy lo atrapa y el humano decide
    IF v_norm_marca IS NOT NULL OR v_norm_modelo IS NOT NULL THEN
        RETURN QUERY
        SELECT
            a.articulo_id::text,
            a.nombre::text,
            a.marca::text,
            a.modelo::text,
            a.codigo_universal::text,
            a.caja_madre::text,
            round((similarity(lower(a.marca || ' ' || a.modelo), lower(p_marca || ' ' || p_modelo)) * 95)::numeric, 1) AS puntaje_match,
            'fuzzy_trgm'::text AS metodo_match,
            'ambiguo'::text AS nivel_match
        FROM articulos a
        WHERE a.activo = true
          AND similarity(lower(a.marca || ' ' || a.modelo), lower(p_marca || ' ' || p_modelo)) > 0.2
        ORDER BY similarity(lower(a.marca || ' ' || a.modelo), lower(p_marca || ' ' || p_modelo)) DESC
        LIMIT 5;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION fn_match_articulo_proveedor(text, text, text) TO anon, authenticated, service_role;

-- 6. Transacción Principal Confirmar Importación y resolver "Descontinuados"
CREATE OR REPLACE FUNCTION public.confirmar_importacion_tx(
    p_importacion_id uuid,
    p_decisiones jsonb,   -- Array de objetos: [{articulo_id, precios: {distribuidor, mayoreo...}, accion}]
    p_proveedor text
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
    v_actualizados int := 0;
    v_nuevos int := 0;
    v_rechazados int := 0;
    d jsonb;
    v_art_id text;
    v_accion text;
    v_precios jsonb;
BEGIN

    FOR d IN SELECT * FROM jsonb_array_elements(p_decisiones)
    LOOP
        v_accion := d->>'accion';
        v_art_id := d->>'articulo_id';
        v_precios := d->'precios';

        IF v_accion = 'actualizar' OR v_accion = 'aceptar_cambio_codigo' THEN
            
            -- UPSERT Atómico (Patrón ERP)
            IF v_precios ? 'distribuidor' THEN
                INSERT INTO costos_articulo (articulo_id, tipo_costo, fuente, valor, importacion_id, vigente, moneda)
                VALUES (v_art_id, 'distribuidor', p_proveedor, (v_precios->>'distribuidor')::numeric, p_importacion_id, true, 'MXN')
                ON CONFLICT (articulo_id, tipo_costo, fuente)
                DO UPDATE SET
                    valor = EXCLUDED.valor,
                    importacion_id = EXCLUDED.importacion_id,
                    vigente = true,
                    creado_el = now()
                WHERE costos_articulo.valor IS DISTINCT FROM EXCLUDED.valor
                   OR costos_articulo.vigente IS NOT TRUE;
            END IF;

            -- Repetir Upsert para cada tier...
            IF v_precios ? 'subdistribuidor' THEN
                INSERT INTO costos_articulo (articulo_id, tipo_costo, fuente, valor, importacion_id, vigente, moneda)
                VALUES (v_art_id, 'subdistribuidor', p_proveedor, (v_precios->>'subdistribuidor')::numeric, p_importacion_id, true, 'MXN')
                ON CONFLICT (articulo_id, tipo_costo, fuente)
                DO UPDATE SET valor=EXCLUDED.valor, importacion_id=EXCLUDED.importacion_id, vigente=true, creado_el=now()
                WHERE costos_articulo.valor IS DISTINCT FROM EXCLUDED.valor OR costos_articulo.vigente IS NOT TRUE;
            END IF;

            IF v_precios ? 'lista' THEN
                INSERT INTO costos_articulo (articulo_id, tipo_costo, fuente, valor, importacion_id, vigente, moneda)
                VALUES (v_art_id, 'lista', p_proveedor, (v_precios->>'lista')::numeric, p_importacion_id, true, 'MXN')
                ON CONFLICT (articulo_id, tipo_costo, fuente)
                DO UPDATE SET valor=EXCLUDED.valor, importacion_id=EXCLUDED.importacion_id, vigente=true, creado_el=now()
                WHERE costos_articulo.valor IS DISTINCT FROM EXCLUDED.valor OR costos_articulo.vigente IS NOT TRUE;
            END IF;

            IF v_precios ? 'mayoreo' THEN
                INSERT INTO costos_articulo (articulo_id, tipo_costo, fuente, valor, importacion_id, vigente, moneda)
                VALUES (v_art_id, 'mayoreo', p_proveedor, (v_precios->>'mayoreo')::numeric, p_importacion_id, true, 'MXN')
                ON CONFLICT (articulo_id, tipo_costo, fuente)
                DO UPDATE SET valor=EXCLUDED.valor, importacion_id=EXCLUDED.importacion_id, vigente=true, creado_el=now()
                WHERE costos_articulo.valor IS DISTINCT FROM EXCLUDED.valor OR costos_articulo.vigente IS NOT TRUE;
            END IF;

            v_actualizados := v_actualizados + 1;
            
        ELSIF v_accion = 'crear_nuevo' THEN
            v_nuevos := v_nuevos + 1;
            -- La inyección la hará el frontend luego de mapearlo a `articulos`
        ELSIF v_accion = 'rechazar' THEN
            v_rechazados := v_rechazados + 1;
        END IF;

    END LOOP;

    -- PURGA: Omisión de Descontinuados (Acatando Condición B y Solicitud del Usuario)
    UPDATE costos_articulo
    SET estado_match = 'descontinuado_por_proveedor'
    WHERE fuente = p_proveedor
      AND vigente = true
      AND articulo_id NOT IN (
          SELECT (d->>'articulo_id')::text
          FROM jsonb_array_elements(p_decisiones) d
          WHERE d->>'articulo_id' IS NOT NULL AND d->>'accion' != 'rechazar'
      );

    -- Cierre formal del lote
    UPDATE importaciones_excel 
    SET estado = 'completada', 
        filas_con_match = v_actualizados + v_nuevos 
    WHERE id = p_importacion_id;

    RETURN jsonb_build_object(
        'actualizados', v_actualizados, 
        'nuevos', v_nuevos, 
        'rechazados', v_rechazados
    );
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    RAISE;
END;
$$;

COMMIT;

/*
-- =============================================================================
-- ROLLBACK SCRIPT 
-- =============================================================================
BEGIN;
DROP FUNCTION IF EXISTS public.confirmar_importacion_tx(uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.fn_match_articulo_proveedor(text, text, text);
DROP TABLE IF EXISTS public.auditoria_cambios_codigo;
ALTER TABLE costos_articulo DROP CONSTRAINT IF EXISTS chk_costos_articulo_estado_match;
DROP INDEX IF EXISTS idx_articulos_marca_norm;
DROP INDEX IF EXISTS idx_articulos_modelo_norm;
DROP INDEX IF EXISTS idx_articulos_codigo_norm;
COMMIT;
*/
