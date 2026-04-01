-- v46_rpc_regulatorio.sql
-- Actualiza guardar_ficha_autoficha para persistir los 4 campos regulatorios/etiquetado.
-- Los campos quedan en columnas canónicas (patrón v41a) Y en el bloque 'seguridad'
-- del JSONB ficha_tecnica_data para consistencia del snapshot histórico.
-- EJECUTAR EN: Supabase SQL Editor (ryxdqnzyvnrwalylqyvm)
-- REQUIERE: v45 ejecutado (columnas ya existen)
-- RETROCOMPATIBLE con v41b: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION guardar_ficha_autoficha(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_fuente_id   uuid;
    v_ficha_id    uuid;
    v_articulo_id text;
    v_mode        text;
BEGIN
    v_mode := COALESCE(p->>'p_mode', 'draft');
    v_articulo_id := NULLIF(COALESCE(p->>'articulo_id', ''), '');

    IF v_mode NOT IN ('create', 'update', 'link_only', 'draft') THEN
        RAISE EXCEPTION 'p_mode inválido: %. Usa create | update | link_only | draft.', v_mode;
    END IF;

    IF v_mode != 'draft' AND (v_articulo_id IS NULL OR v_articulo_id = '') THEN
        RAISE EXCEPTION 'articulo_id es requerido para el modo "%". Usa p_mode="draft" para fichas sin vínculo.', v_mode;
    END IF;

    -- ── Auditoría del documento ───────────────────────────────────────────────
    INSERT INTO fuentes_documento (
        nombre_archivo, url_storage, url_origen, tipo_archivo,
        tamano_bytes, texto_extraido, procesado,
        ocr_proveedor, ocr_confianza_global, llm_proveedor, llm_modelo,
        estado_procesamiento, estructura_detectada
    ) VALUES (
        p->>'nombre_archivo', p->>'url_storage', p->>'url_origen', p->>'tipo_archivo',
        (p->>'tamano_bytes')::bigint, p->>'texto_extraido', true,
        'azure-document-intelligence', (p->>'ocr_confianza')::numeric,
        'openai', 'gpt-4o-mini', 'completado',
        jsonb_build_object('categoria', p->>'categoria', 'confidence', p->>'confidence', 'mode', v_mode)
    ) RETURNING id INTO v_fuente_id;

    -- ── Artículo (modos create / update / link_only) ──────────────────────────
    IF v_mode = 'create' THEN
        INSERT INTO articulos (
            articulo_id, nombre, marca, modelo, variante, categoria,
            descripcion, codigo_universal, codigo_sat,
            peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen
        ) VALUES (
            v_articulo_id, p->>'nombre', p->>'marca',
            NULLIF(p->>'modelo',''), NULLIF(p->>'variante',''), NULLIF(p->>'categoria',''),
            NULLIF(p->>'descripcion',''), NULLIF(p->>'codigo_universal',''), NULLIF(p->>'codigo_sat',''),
            (p->>'peso_kg')::numeric, (p->>'largo_cm')::numeric, (p->>'ancho_cm')::numeric,
            (p->>'alto_cm')::numeric, NULLIF(p->>'materiales',''), NULLIF(p->>'pais_origen','')
        );
        INSERT INTO inventory_snapshot (sku, physical_stock)
        VALUES (v_articulo_id, 0) ON CONFLICT (sku) DO NOTHING;

    ELSIF v_mode = 'update' THEN
        INSERT INTO articulos (
            articulo_id, nombre, marca, modelo, variante, categoria,
            descripcion, codigo_universal, codigo_sat,
            peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen
        ) VALUES (
            v_articulo_id, p->>'nombre', p->>'marca',
            NULLIF(p->>'modelo',''), NULLIF(p->>'variante',''), NULLIF(p->>'categoria',''),
            NULLIF(p->>'descripcion',''), NULLIF(p->>'codigo_universal',''), NULLIF(p->>'codigo_sat',''),
            (p->>'peso_kg')::numeric, (p->>'largo_cm')::numeric, (p->>'ancho_cm')::numeric,
            (p->>'alto_cm')::numeric, NULLIF(p->>'materiales',''), NULLIF(p->>'pais_origen','')
        ) ON CONFLICT (articulo_id) DO UPDATE SET
            nombre           = CASE WHEN articulos.nombre IS NULL OR articulos.nombre = '' THEN EXCLUDED.nombre ELSE articulos.nombre END,
            marca            = CASE WHEN articulos.marca  IS NULL OR articulos.marca  = '' THEN EXCLUDED.marca  ELSE articulos.marca  END,
            modelo           = COALESCE(articulos.modelo,           EXCLUDED.modelo),
            variante         = COALESCE(articulos.variante,         EXCLUDED.variante),
            descripcion      = COALESCE(articulos.descripcion,      EXCLUDED.descripcion),
            codigo_universal = COALESCE(articulos.codigo_universal, EXCLUDED.codigo_universal),
            codigo_sat       = COALESCE(articulos.codigo_sat,       EXCLUDED.codigo_sat),
            peso_kg          = COALESCE(articulos.peso_kg,          EXCLUDED.peso_kg),
            largo_cm         = COALESCE(articulos.largo_cm,         EXCLUDED.largo_cm),
            ancho_cm         = COALESCE(articulos.ancho_cm,         EXCLUDED.ancho_cm),
            alto_cm          = COALESCE(articulos.alto_cm,          EXCLUDED.alto_cm),
            materiales       = COALESCE(articulos.materiales,       EXCLUDED.materiales),
            pais_origen      = COALESCE(articulos.pais_origen,      EXCLUDED.pais_origen),
            actualizado_el   = now();
        INSERT INTO inventory_snapshot (sku, physical_stock)
        VALUES (v_articulo_id, 0) ON CONFLICT (sku) DO NOTHING;

    ELSIF v_mode = 'link_only' THEN
        IF NOT EXISTS (SELECT 1 FROM articulos WHERE articulo_id = v_articulo_id) THEN
            RAISE EXCEPTION 'El artículo % no existe en el catálogo.', v_articulo_id;
        END IF;
    END IF;

    -- ── Ficha técnica — con columnas propias + columnas regulatorias ──────────
    INSERT INTO fichas_tecnicas (
        articulo_id,
        nombre_producto,
        -- Identidad propia (no depende del JOIN con articulos)
        marca, modelo, variante, codigo_universal, categoria,
        peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen,
        -- Campos de contenido
        descripcion, descripcion_larga, especificaciones, ingredientes,
        uso_recomendado, precauciones, fabricante,
        bullet_points, palabras_clave,
        -- Campos regulatorios / etiquetado obligatorio (v46)
        informacion_normativa, instrucciones_uso,
        leyendas_precautorias, indicaciones_almacenamiento,
        -- Atributos dinámicos
        atributos_dinamicos, atributos_categoria, atributos_extras,
        ficha_tecnica_data, estado
    ) VALUES (
        v_articulo_id,
        p->>'nombre',
        -- Identidad
        NULLIF(p->>'marca',''),
        NULLIF(p->>'modelo',''),
        NULLIF(p->>'variante',''),
        NULLIF(p->>'codigo_universal',''),
        NULLIF(p->>'categoria',''),
        (p->>'peso_kg')::numeric,
        (p->>'largo_cm')::numeric,
        (p->>'ancho_cm')::numeric,
        (p->>'alto_cm')::numeric,
        NULLIF(p->>'materiales',''),
        NULLIF(p->>'pais_origen',''),
        -- Contenido
        NULLIF(p->>'descripcion',''), NULLIF(p->>'descripcion_larga',''),
        NULLIF(p->>'especificaciones',''), NULLIF(p->>'ingredientes',''),
        NULLIF(p->>'uso_recomendado',''), NULLIF(p->>'precauciones',''),
        NULLIF(COALESCE(p->>'fabricante', p->>'marca'),''),
        CASE WHEN jsonb_typeof(p->'bullet_points') = 'array' THEN p->'bullet_points' ELSE '[]'::jsonb END,
        CASE WHEN jsonb_typeof(p->'palabras_clave') = 'array' THEN p->'palabras_clave' ELSE '[]'::jsonb END,
        -- Regulatorios (v46)
        NULLIF(p->>'informacion_normativa',''),
        NULLIF(p->>'instrucciones_uso',''),
        NULLIF(p->>'leyendas_precautorias',''),
        NULLIF(p->>'indicaciones_almacenamiento',''),
        -- Atributos
        COALESCE(p->'atributos_tecnicos', '{}'::jsonb),
        COALESCE(p->'atributos_categoria', '{}'::jsonb),
        COALESCE(p->'atributos_extras', '{}'::jsonb),
        -- Snapshot JSONB completo
        jsonb_build_object(
            'identificacion', jsonb_build_object(
                'nombre_producto', p->>'nombre', 'sku_detectado', p->>'sku_detectado',
                'codigo_barras', p->>'codigo_universal', 'marca', p->>'marca',
                'fabricante', p->>'fabricante', 'modelo', p->>'modelo', 'variante', p->>'variante'
            ),
            'descripcion', jsonb_build_object(
                'corta', p->>'descripcion', 'larga', p->>'descripcion_larga',
                'bullet_points', COALESCE(p->'bullet_points', '[]'::jsonb)
            ),
            'especificaciones', jsonb_build_object(
                'peso_kg', p->>'peso_kg', 'largo_cm', p->>'largo_cm',
                'ancho_cm', p->>'ancho_cm', 'alto_cm', p->>'alto_cm',
                'materiales', p->>'materiales', 'pais_origen', p->>'pais_origen',
                'especificaciones_texto', p->>'especificaciones'
            ),
            'atributos_tecnicos', COALESCE(p->'atributos_tecnicos', '{}'::jsonb),
            'clasificacion', jsonb_build_object('categoria', p->>'categoria', 'codigo_sat', p->>'codigo_sat'),
            'marketplace', jsonb_build_object('palabras_clave', COALESCE(p->'palabras_clave', '[]'::jsonb)),
            'seguridad', jsonb_build_object(
                'precauciones',            p->>'precauciones',
                'uso_recomendado',         p->>'uso_recomendado',
                'ingredientes',            p->>'ingredientes',
                -- Campos regulatorios en el snapshot (v46)
                'informacion_normativa',       p->>'informacion_normativa',
                'instrucciones_uso',           p->>'instrucciones_uso',
                'leyendas_precautorias',       p->>'leyendas_precautorias',
                'indicaciones_almacenamiento', p->>'indicaciones_almacenamiento'
            )
        ),
        'borrador'
    ) RETURNING id INTO v_ficha_id;

    -- ── Audit trail ───────────────────────────────────────────────────────────
    INSERT INTO ficha_extracciones (ficha_tecnica_id, fuente_documento_id, extraccion_cruda, aplicada_a_ficha)
    VALUES (v_ficha_id, v_fuente_id, p, true);

    RETURN jsonb_build_object(
        'ok', true, 'mode', v_mode,
        'articulo_id', v_articulo_id,
        'ficha_id', v_ficha_id, 'fuente_id', v_fuente_id,
        'vinculado', v_articulo_id IS NOT NULL
    );

EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$;

COMMENT ON FUNCTION guardar_ficha_autoficha(jsonb) IS
'v46: Persiste 4 campos regulatorios/etiquetado como columnas canónicas en fichas_tecnicas:
informacion_normativa, instrucciones_uso, leyendas_precautorias, indicaciones_almacenamiento.
También los incluye en el bloque seguridad del snapshot JSONB ficha_tecnica_data.
Retrocompatible con v41b: si el frontend no envía los campos, quedan NULL (no error).
Modos: draft (default) | create | update | link_only.';
