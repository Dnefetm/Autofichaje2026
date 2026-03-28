-- v39b_rpc_modo_draft.sql
-- Actualiza guardar_ficha_autoficha para soportar modo 'draft':
--   fichas técnicas sin artículo obligatorio (articulo_id puede ser NULL).
-- Retrocompatible con los 3 modos existentes: create | update | link_only.
-- EJECUTAR EN: Supabase SQL Editor (proyecto ryxdqnzyvnrwalylqyvm)
-- REQUIERE: v37 + v35 ejecutados

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

    -- articulo_id es OPCIONAL en modo draft. En los demás modos, es requerido.
    -- NULLIF borra strings vacíos para que queden NULL (no el string '').
    v_articulo_id := NULLIF(COALESCE(p->>'articulo_id', ''), '');

    IF v_mode NOT IN ('create', 'update', 'link_only', 'draft') THEN
        RAISE EXCEPTION 'p_mode inválido: %. Usa create | update | link_only | draft.', v_mode;
    END IF;

    -- Modos que requieren artículo deben tenerlo
    IF v_mode != 'draft' AND (v_articulo_id IS NULL OR v_articulo_id = '') THEN
        RAISE EXCEPTION 'articulo_id es requerido para el modo "%". Usa p_mode="draft" para fichas sin vínculo.', v_mode;
    END IF;

    -- ── Paso 1: Auditoría del documento (siempre, incluso en draft) ──────────
    INSERT INTO fuentes_documento (
        nombre_archivo, url_storage, url_origen, tipo_archivo,
        tamano_bytes, texto_extraido, procesado,
        ocr_proveedor, ocr_confianza_global,
        llm_proveedor, llm_modelo,
        estado_procesamiento, estructura_detectada
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
        'openai', 'gpt-4o-mini',
        'completado',
        jsonb_build_object('categoria', p->>'categoria', 'confidence', p->>'confidence', 'mode', v_mode)
    ) RETURNING id INTO v_fuente_id;

    -- ── Paso 2: Artículo — SOLO si mode != draft ─────────────────────────────

    IF v_mode = 'create' THEN
        INSERT INTO articulos (
            articulo_id, nombre, marca, modelo, variante, categoria,
            descripcion, codigo_universal, codigo_sat,
            peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen
        ) VALUES (
            v_articulo_id,
            p->>'nombre', p->>'marca',
            NULLIF(p->>'modelo', ''), NULLIF(p->>'variante', ''), NULLIF(p->>'categoria', ''),
            NULLIF(p->>'descripcion', ''), NULLIF(p->>'codigo_universal', ''), NULLIF(p->>'codigo_sat', ''),
            (p->>'peso_kg')::numeric, (p->>'largo_cm')::numeric, (p->>'ancho_cm')::numeric,
            (p->>'alto_cm')::numeric, NULLIF(p->>'materiales', ''), NULLIF(p->>'pais_origen', '')
        );
        INSERT INTO inventory_snapshot (sku, physical_stock)
        VALUES (v_articulo_id, 0) ON CONFLICT (sku) DO NOTHING;

    ELSIF v_mode = 'update' THEN
        INSERT INTO articulos (
            articulo_id, nombre, marca, modelo, variante, categoria,
            descripcion, codigo_universal, codigo_sat,
            peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen
        ) VALUES (
            v_articulo_id,
            p->>'nombre', p->>'marca',
            NULLIF(p->>'modelo', ''), NULLIF(p->>'variante', ''), NULLIF(p->>'categoria', ''),
            NULLIF(p->>'descripcion', ''), NULLIF(p->>'codigo_universal', ''), NULLIF(p->>'codigo_sat', ''),
            (p->>'peso_kg')::numeric, (p->>'largo_cm')::numeric, (p->>'ancho_cm')::numeric,
            (p->>'alto_cm')::numeric, NULLIF(p->>'materiales', ''), NULLIF(p->>'pais_origen', '')
        )
        ON CONFLICT (articulo_id) DO UPDATE SET
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
            RAISE EXCEPTION 'El artículo % no existe en el catálogo. Usa create o update.', v_articulo_id;
        END IF;

    -- ELSIF v_mode = 'draft' → no toca articulos ni inventory_snapshot
    END IF;

    -- ── Paso 3: Ficha técnica — articulo_id puede ser NULL en modo draft ─────
    INSERT INTO fichas_tecnicas (
        articulo_id,           -- NULL en draft — la ficha existe sin artículo
        nombre_producto,
        descripcion,
        descripcion_larga,
        especificaciones,
        ingredientes,
        uso_recomendado,
        precauciones,
        fabricante,
        bullet_points,
        palabras_clave,
        atributos_dinamicos,
        atributos_categoria,
        atributos_extras,
        ficha_tecnica_data,
        estado
    ) VALUES (
        v_articulo_id,         -- NULL en draft
        p->>'nombre',
        NULLIF(p->>'descripcion', ''),
        NULLIF(p->>'descripcion_larga', ''),
        NULLIF(p->>'especificaciones', ''),
        NULLIF(p->>'ingredientes', ''),
        NULLIF(p->>'uso_recomendado', ''),
        NULLIF(p->>'precauciones', ''),
        NULLIF(COALESCE(p->>'fabricante', p->>'marca'), ''),
        CASE WHEN p->'bullet_points' IS NOT NULL AND jsonb_typeof(p->'bullet_points') = 'array'
             THEN p->'bullet_points' ELSE '[]'::jsonb END,
        CASE WHEN p->'palabras_clave' IS NOT NULL AND jsonb_typeof(p->'palabras_clave') = 'array'
             THEN p->'palabras_clave' ELSE '[]'::jsonb END,
        COALESCE(p->'atributos_tecnicos', '{}'::jsonb),
        COALESCE(p->'atributos_categoria', '{}'::jsonb),
        COALESCE(p->'atributos_extras', '{}'::jsonb),
        jsonb_build_object(
            'identificacion', jsonb_build_object(
                'nombre_producto', p->>'nombre',
                'sku_detectado',   p->>'sku_detectado',
                'codigo_barras',   p->>'codigo_universal',
                'marca',           p->>'marca',
                'fabricante',      p->>'fabricante',
                'modelo',          p->>'modelo',
                'variante',        p->>'variante'
            ),
            'descripcion', jsonb_build_object(
                'corta',         p->>'descripcion',
                'larga',         p->>'descripcion_larga',
                'bullet_points', COALESCE(p->'bullet_points', '[]'::jsonb)
            ),
            'especificaciones', jsonb_build_object(
                'peso_kg',               p->>'peso_kg',
                'largo_cm',              p->>'largo_cm',
                'ancho_cm',              p->>'ancho_cm',
                'alto_cm',               p->>'alto_cm',
                'materiales',            p->>'materiales',
                'pais_origen',           p->>'pais_origen',
                'especificaciones_texto', p->>'especificaciones'
            ),
            'atributos_tecnicos',  COALESCE(p->'atributos_tecnicos', '{}'::jsonb),
            'clasificacion', jsonb_build_object(
                'categoria',  p->>'categoria',
                'codigo_sat', p->>'codigo_sat'
            ),
            'marketplace', jsonb_build_object(
                'palabras_clave', COALESCE(p->'palabras_clave', '[]'::jsonb)
            ),
            'seguridad', jsonb_build_object(
                'precauciones',    p->>'precauciones',
                'uso_recomendado', p->>'uso_recomendado',
                'ingredientes',    p->>'ingredientes'
            )
        ),
        'borrador'
    ) RETURNING id INTO v_ficha_id;

    -- ── Paso 4: Audit trail ──────────────────────────────────────────────────
    INSERT INTO ficha_extracciones (ficha_tecnica_id, fuente_documento_id, extraccion_cruda, aplicada_a_ficha)
    VALUES (v_ficha_id, v_fuente_id, p, true);

    RETURN jsonb_build_object(
        'ok',          true,
        'mode',        v_mode,
        'articulo_id', v_articulo_id,
        'ficha_id',    v_ficha_id,
        'fuente_id',   v_fuente_id,
        'vinculado',   v_articulo_id IS NOT NULL
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;

COMMENT ON FUNCTION guardar_ficha_autoficha(jsonb) IS
'RPC transaccional Autofichas v4 (v39b). Agrega modo draft: fichas sin artículo vinculado.
Modos via p->>''p_mode'': draft (default) | create | update | link_only.
En modo draft: articulo_id puede ser NULL — no toca articulos ni inventory_snapshot.
Retrocompatible con v37: los 3 modos anteriores funcionan igual.';
