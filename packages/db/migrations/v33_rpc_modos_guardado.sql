-- v33_rpc_modos_guardado.sql
-- Agrega parámetro p_mode a guardar_ficha_autoficha:
--   'create'    → INSERT nuevo artículo + ficha (falla si el articulo_id ya existe)
--   'update'    → UPSERT de artículo (rellena vacíos, no sobreescribe existentes) + nueva ficha
--   'link_only' → Solo crea la ficha técnica y la vincula al artículo existente,
--                 SIN tocar los datos del artículo del catálogo
-- Ejecutar en Supabase SQL Editor (proyecto ryxdqnzyvnrwalylqyvm)

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
    v_articulo_id := COALESCE(p->>'articulo_id', p->>'sku_detectado');
    v_mode        := COALESCE(p->>'p_mode', 'update'); -- default: update (comportamiento anterior)

    IF v_articulo_id IS NULL OR v_articulo_id = '' THEN
        RAISE EXCEPTION 'articulo_id no puede estar vacío';
    END IF;

    IF v_mode NOT IN ('create', 'update', 'link_only') THEN
        RAISE EXCEPTION 'p_mode inválido: %. Usa create | update | link_only.', v_mode;
    END IF;

    -- ── Paso 1: Auditoría del documento ──────────────────────────────────────
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

    -- ── Paso 2: Artículo — comportamiento según p_mode ───────────────────────

    IF v_mode = 'create' THEN
        -- INSERT puro — falla con error claro si ya existe
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
        -- inventory inicial
        INSERT INTO inventory_snapshot (sku, physical_stock) VALUES (v_articulo_id, 0) ON CONFLICT (sku) DO NOTHING;

    ELSIF v_mode = 'update' THEN
        -- UPSERT — rellena vacíos, nunca sobreescribe datos existentes
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
        INSERT INTO inventory_snapshot (sku, physical_stock) VALUES (v_articulo_id, 0) ON CONFLICT (sku) DO NOTHING;

    ELSIF v_mode = 'link_only' THEN
        -- Verificar que el artículo existe
        IF NOT EXISTS (SELECT 1 FROM articulos WHERE articulo_id = v_articulo_id) THEN
            RAISE EXCEPTION 'El artículo % no existe en el catálogo. Usa create o update.', v_articulo_id;
        END IF;
        -- No toca los datos del artículo
    END IF;

    -- ── Paso 3: Ficha técnica ────────────────────────────────────────────────
    INSERT INTO fichas_tecnicas (articulo_id, nombre_producto, descripcion, estado)
    VALUES (v_articulo_id, p->>'nombre', p->>'descripcion', 'borrador')
    RETURNING id INTO v_ficha_id;

    -- ── Paso 4: Audit trail ─────────────────────────────────────────────────
    INSERT INTO ficha_extracciones (ficha_tecnica_id, fuente_documento_id, extraccion_cruda, aplicada_a_ficha)
    VALUES (v_ficha_id, v_fuente_id, p, true);

    RETURN jsonb_build_object(
        'ok',          true,
        'mode',        v_mode,
        'articulo_id', v_articulo_id,
        'ficha_id',    v_ficha_id,
        'fuente_id',   v_fuente_id
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;

COMMENT ON FUNCTION guardar_ficha_autoficha(jsonb) IS
'RPC transaccional Autofichas v2. Soporta 3 modos vía p->>"p_mode":
 create    → INSERT nuevo artículo (falla si ya existe)
 update    → UPSERT artículo rellena vacíos solamente (default)
 link_only → Solo crea la ficha técnica, no toca el artículo existente
 Siempre crea fuentes_documento + fichas_tecnicas + ficha_extracciones.';
