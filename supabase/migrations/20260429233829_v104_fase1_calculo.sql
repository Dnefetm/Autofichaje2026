-- SECCIÓN 2 - FASE 1: Motor de cálculo de precio público

-- 1. Tabla reglas_precio
CREATE TABLE IF NOT EXISTS public.reglas_precio (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre text NOT NULL,
    canal text NOT NULL,
    marca_filtro text,
    categoria_filtro text,
    margen_pct numeric DEFAULT 0,
    retenciones jsonb DEFAULT '[]'::jsonb,
    costos_fijos numeric DEFAULT 0,
    prioridad int DEFAULT 0,
    activa boolean DEFAULT true,
    creado_el timestamp with time zone DEFAULT now(),
    actualizado_el timestamp with time zone DEFAULT now()
);

-- 2. Tabla precios_publicados
CREATE TABLE IF NOT EXISTS public.precios_publicados (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    articulo_id text REFERENCES public.articulos(articulo_id) ON DELETE CASCADE,
    canal text NOT NULL,
    regla_id uuid REFERENCES public.reglas_precio(id) ON DELETE SET NULL,
    precio numeric NOT NULL,
    costo_base numeric NOT NULL,
    margen_aplicado numeric,
    retenciones_aplicadas jsonb,
    calculated_at timestamp with time zone DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_precios_publicados_articulo_canal ON public.precios_publicados (articulo_id, canal);

-- 3. Cola precio_recalc_queue
CREATE TABLE IF NOT EXISTS public.precio_recalc_queue (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    articulo_id text REFERENCES public.articulos(articulo_id) ON DELETE CASCADE,
    canal text,
    prioridad int DEFAULT 0,
    encolado_at timestamp with time zone DEFAULT now(),
    procesado_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS idx_precio_recalc_queue_pending ON public.precio_recalc_queue (encolado_at) WHERE procesado_at IS NULL;

-- 4. Cola ml_publicacion_sync_queue (Phase 4)
CREATE TABLE IF NOT EXISTS public.ml_publicacion_sync_queue (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    articulo_id text REFERENCES public.articulos(articulo_id) ON DELETE CASCADE,
    estado text DEFAULT 'pendiente',
    creado_el timestamp with time zone DEFAULT now(),
    procesado_el timestamp with time zone,
    intentos int DEFAULT 0,
    error_log text
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ml_sync_queue_articulo ON public.ml_publicacion_sync_queue (articulo_id) WHERE estado = 'pendiente';

-- 5. Función de calculo matematico (precio final)
CREATE OR REPLACE FUNCTION public.fn_calcular_precio_publico(p_articulo_id text, p_regla_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_costo numeric;
    v_margen numeric;
    v_retenciones numeric := 0;
    v_fijos numeric := 0;
    v_ret jsonb;
    v_elem jsonb;
    v_precio_final numeric;
BEGIN
    -- Obtener costo base: preferir costo vigente
    SELECT valor INTO v_costo 
    FROM costos_articulo 
    WHERE articulo_id = p_articulo_id AND vigente = true 
    ORDER BY tipo_costo ASC LIMIT 1;

    IF v_costo IS NULL THEN
        RETURN NULL;
    END IF;

    -- Obtener parametros de la regla
    SELECT margen_pct, retenciones, costos_fijos 
    INTO v_margen, v_ret, v_fijos
    FROM reglas_precio WHERE id = p_regla_id;

    -- Sumar retenciones porcentuales
    IF v_ret IS NOT NULL AND jsonb_typeof(v_ret) = 'array' THEN
        FOR v_elem IN SELECT * FROM jsonb_array_elements(v_ret)
        LOOP
            v_retenciones := v_retenciones + COALESCE((v_elem->>'porcentaje')::numeric, 0);
        END LOOP;
    END IF;

    -- Formula inversa: precio = (costo + fijos) / (1 - margen% - retenciones%)
    IF (1 - (v_margen / 100.0) - (v_retenciones / 100.0)) <= 0 THEN
        RETURN v_costo + v_fijos; -- Fallback para evitar divisor 0 o negativo
    END IF;

    v_precio_final := (v_costo + v_fijos) / (1 - (v_margen / 100.0) - (v_retenciones / 100.0));
    RETURN round(v_precio_final, 2);
END;
$$;

-- 6. Funcion de recalculo (asincrono por worker)
CREATE OR REPLACE FUNCTION public.fn_recalcular_lote(p_articulo_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_art text;
    v_regla record;
    v_precio numeric;
    v_costo numeric;
    v_old_precio numeric;
BEGIN
    FOR v_art IN SELECT unnest(p_articulo_ids)
    LOOP
        -- Buscar la regla aplicable para cada articulo
        -- (Aqui podriamos filtrar por marca/categoria)
        FOR v_regla IN 
            SELECT id, canal, margen_pct, retenciones 
            FROM reglas_precio 
            WHERE activa = true 
            ORDER BY prioridad DESC, creado_el ASC
        LOOP
            v_precio := fn_calcular_precio_publico(v_art, v_regla.id);
            
            IF v_precio IS NOT NULL THEN
                SELECT valor INTO v_costo FROM costos_articulo WHERE articulo_id = v_art AND vigente = true ORDER BY tipo_costo ASC LIMIT 1;
                
                -- Guardar precio anterior para ver si cambio
                SELECT precio INTO v_old_precio FROM precios_publicados WHERE articulo_id = v_art AND canal = v_regla.canal;

                INSERT INTO precios_publicados (articulo_id, canal, regla_id, precio, costo_base, margen_aplicado, retenciones_aplicadas, calculated_at)
                VALUES (v_art, v_regla.canal, v_regla.id, v_precio, v_costo, v_regla.margen_pct, v_regla.retenciones, now())
                ON CONFLICT (articulo_id, canal) DO UPDATE SET
                    regla_id = EXCLUDED.regla_id,
                    precio = EXCLUDED.precio,
                    costo_base = EXCLUDED.costo_base,
                    margen_aplicado = EXCLUDED.margen_aplicado,
                    retenciones_aplicadas = EXCLUDED.retenciones_aplicadas,
                    calculated_at = now();
                    
                -- Si el precio cambio y es mercadolibre, encolar para sync
                IF v_regla.canal = 'mercadolibre' AND (v_old_precio IS NULL OR v_old_precio <> v_precio) THEN
                    INSERT INTO ml_publicacion_sync_queue (articulo_id, estado) VALUES (v_art, 'pendiente') ON CONFLICT DO NOTHING;
                END IF;
            END IF;
        END LOOP;
    END LOOP;
END;
$$;

-- 7. Eliminar triggers sincronos pesados
DROP TRIGGER IF EXISTS tg_recalc_precio_publico ON public.costos_articulo;
DROP FUNCTION IF EXISTS public.fn_tg_recalc_precio_publico() CASCADE;

-- En su lugar, el update de costos encola a precio_recalc_queue (asincrono)
CREATE OR REPLACE FUNCTION public.fn_tg_encolar_recalculo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO precio_recalc_queue (articulo_id) 
    VALUES (COALESCE(NEW.articulo_id, OLD.articulo_id));
    RETURN NULL;
END;
$$;

CREATE TRIGGER tg_encolar_recalculo
AFTER INSERT OR UPDATE OF valor, vigente ON public.costos_articulo
FOR EACH ROW
WHEN (NEW.articulo_id IS NOT NULL)
EXECUTE FUNCTION public.fn_tg_encolar_recalculo();
