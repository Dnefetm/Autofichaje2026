-- v31_autofichas.sql
-- Fase 3 del módulo Autofichas: conexión fichas_tecnicas → articulos +
-- función RPC transaccional para guardar ficha completa sin datos huérfanos
-- Ejecutar en Supabase SQL Editor (proyecto ryxdqnzyvnrwalylqyvm)

-- ─── 1. Desacoplar fichas_tecnicas de la tabla 'productos' (inexistente) ────────

ALTER TABLE fichas_tecnicas
    ADD COLUMN IF NOT EXISTS articulo_id text REFERENCES articulos(articulo_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ft_articulo_id ON fichas_tecnicas(articulo_id);

-- ─── 2. RPC transaccional: guardar ficha completa ──────────────────────────────
-- Orden correcto de inserción para respetar FK constraints:
--   fuentes_documento (sin FKs) → articulos (upsert) →
--   inventory_snapshot (upsert) → fichas_tecnicas → ficha_extracciones

CREATE OR REPLACE FUNCTION guardar_ficha_autoficha(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_fuente_id  uuid;
    v_ficha_id   uuid;
    v_articulo_id text;
BEGIN
    v_articulo_id := COALESCE(p->>'articulo_id', p->>'sku_detectado');

    IF v_articulo_id IS NULL OR v_articulo_id = '' THEN
        RAISE EXCEPTION 'articulo_id no puede estar vacío';
    END IF;

    -- Paso 1: Insertar registro de fuente del documento (auditoría OCR/LLM)
    INSERT INTO fuentes_documento (
        nombre_archivo,
        url_storage,
        url_origen,
        tipo_archivo,
        tamano_bytes,
        texto_extraido,
        procesado,
        ocr_proveedor,
        ocr_confianza_global,
        llm_proveedor,
        llm_modelo,
        estado_procesamiento,
        estructura_detectada
    ) VALUES (
        p->>'nombre_archivo',
        p->>'url_storage',
        p->>'url_origen',
        p->>'tipo_archivo',
        (p->>'tamano_bytes')::bigint,
        p->>'texto_extraido',
        true,
        'azure-document-intelligence',
        (p->>'ocr_confianza')::numeric,
        'openai',
        'gpt-4o-mini',
        'completado',
        jsonb_build_object('categoria', p->>'categoria', 'confidence', p->>'confidence')
    ) RETURNING id INTO v_fuente_id;

    -- Paso 2: Upsert del artículo — nunca falla si ya existe
    INSERT INTO articulos (
        articulo_id, nombre, marca, modelo, variante, categoria,
        descripcion, codigo_universal, codigo_sat,
        peso_kg, largo_cm, ancho_cm, alto_cm,
        materiales, pais_origen
    ) VALUES (
        v_articulo_id,
        p->>'nombre',
        p->>'marca',
        NULLIF(p->>'modelo', ''),
        NULLIF(p->>'variante', ''),
        NULLIF(p->>'categoria', ''),
        NULLIF(p->>'descripcion', ''),
        NULLIF(p->>'codigo_universal', ''),
        NULLIF(p->>'codigo_sat', ''),
        (p->>'peso_kg')::numeric,
        (p->>'largo_cm')::numeric,
        (p->>'ancho_cm')::numeric,
        (p->>'alto_cm')::numeric,
        NULLIF(p->>'materiales', ''),
        NULLIF(p->>'pais_origen', '')
    )
    ON CONFLICT (articulo_id) DO UPDATE SET
        -- Solo actualiza campos que estaban vacíos — no sobreescribe datos existentes
        nombre           = CASE WHEN articulos.nombre IS NULL OR articulos.nombre = ''
                                THEN EXCLUDED.nombre ELSE articulos.nombre END,
        marca            = CASE WHEN articulos.marca IS NULL OR articulos.marca = ''
                                THEN EXCLUDED.marca ELSE articulos.marca END,
        modelo           = COALESCE(articulos.modelo, EXCLUDED.modelo),
        variante         = COALESCE(articulos.variante, EXCLUDED.variante),
        descripcion      = COALESCE(articulos.descripcion, EXCLUDED.descripcion),
        codigo_universal = COALESCE(articulos.codigo_universal, EXCLUDED.codigo_universal),
        codigo_sat       = COALESCE(articulos.codigo_sat, EXCLUDED.codigo_sat),
        peso_kg          = COALESCE(articulos.peso_kg, EXCLUDED.peso_kg),
        largo_cm         = COALESCE(articulos.largo_cm, EXCLUDED.largo_cm),
        ancho_cm         = COALESCE(articulos.ancho_cm, EXCLUDED.ancho_cm),
        alto_cm          = COALESCE(articulos.alto_cm, EXCLUDED.alto_cm),
        materiales       = COALESCE(articulos.materiales, EXCLUDED.materiales),
        pais_origen      = COALESCE(articulos.pais_origen, EXCLUDED.pais_origen),
        actualizado_el   = now();

    -- Paso 3: Upsert inventory_snapshot (stock inicial = 0 si es nuevo)
    INSERT INTO inventory_snapshot (sku, physical_stock)
    VALUES (v_articulo_id, 0)
    ON CONFLICT (sku) DO NOTHING;

    -- Paso 4: Insertar ficha técnica (articulo_id ya existe en Paso 2)
    INSERT INTO fichas_tecnicas (
        articulo_id,
        nombre_producto,
        descripcion,
        estado
    ) VALUES (
        v_articulo_id,
        p->>'nombre',
        p->>'descripcion',
        'borrador'
    ) RETURNING id INTO v_ficha_id;

    -- Paso 5: Vincular fuente ↔ ficha (con métricas de confianza)
    INSERT INTO ficha_extracciones (
        ficha_tecnica_id,
        fuente_documento_id,
        extraccion_cruda,
        aplicada_a_ficha
    ) VALUES (
        v_ficha_id,
        v_fuente_id,
        p,       -- payload completo como auditoría
        true
    );

    RETURN jsonb_build_object(
        'ok',          true,
        'articulo_id', v_articulo_id,
        'ficha_id',    v_ficha_id,
        'fuente_id',   v_fuente_id
    );

EXCEPTION WHEN OTHERS THEN
    -- plpgsql hace ROLLBACK automático de todo lo anterior
    RAISE;
END;
$$;

COMMENT ON FUNCTION guardar_ficha_autoficha(jsonb) IS
    'RPC transaccional del módulo Autofichas. Inserta en 5 tablas en orden correcto:
     fuentes_documento → articulos (upsert) → inventory_snapshot → fichas_tecnicas → ficha_extracciones.
     Si cualquier paso falla, todas las inserciones anteriores se deshacen automáticamente.';
