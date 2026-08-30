/**
 * POST /api/publish
 *
 * Endpoint para publicar 1 artículo en MeLi (modelo User Products).
 * Flujo de 16 pasos con validaciones y trace completo para diagnóstico.
 * Prueba real exitosa: MLM5120247290 (02/04/2026).
 *
 * v2: Corrige bugs de Comet (stock/precio por articulo_id, family_name por AI, validaciones 422)
 * v3: Paso 1.5 anti-duplicados (409 si ya existe publicación activa en la misma cuenta)
 * v4: ficha_id opcional — ficha técnica tiene prioridad sobre articulos en TODOS los campos;
 *     limpieza de títulos con anotaciones; descripción ≤2000 chars con bullets.
 *
 * Body esperado:
 * {
 *   articulo_id: string,           // UUID del artículo en tabla articulos
 *   marketplace_id: string,        // ID de la cuenta MeLi (marketplace_configs.id)
 *   pictures: string[],            // URLs públicas de imágenes
 *   ficha_id?: string,             // UUID de fichas_tecnicas — si viene, ficha tiene prioridad
 *   category_id?: string,          // Opcional: si ya se conoce la categoría MeLi
 *   listing_type_id?: string,      // Opcional: default "gold_special"
 *   dry_run?: boolean              // Si true, construye el body pero NO envía a MeLi
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { resolvePublicationAI } from '@gestor/sync/meli-ai-helper';

export const dynamic = 'force-dynamic';

// -- Helper: limpiar título de anotaciones operativas -------------------------
// Elimina notas como "publicar y corregir", "revisar", "pendiente" etc.
// que los usuarios añaden al nombre pero no deben llegar a MeLi.
function limpiarTitulo(nombre: string | null | undefined): string {
    if (!nombre) return '';
    // Patrones de anotaciones comunes (case-insensitive)
    const ANOTACIONES = [
        /publicar\s+y\s+corregir/gi,
        /publicar\s+y\s+revisar/gi,
        /revisar\s+y\s+corregir/gi,
        /pendiente\s+de\s+revisi[oó]n/gi,
        /corregir\s+despu[eé]s/gi,
        /publicar.*$\*/gi,  // trailing *
        /\brevisar\b.*$/gi,
        /\bcorregir\b.*$/gi,
        /\bpendiente\b.*$/gi,
        /\bcheck\b.*$/gi,
    ];
    let limpio = nombre.trim();
    for (const pat of ANOTACIONES) {
        limpio = limpio.replace(pat, '').trim();
    }
    // Eliminar separadores sobrantes al final (guion, coma, barra)
    limpio = limpio.replace(/[-,/|]+\s*$/, '').trim();
    return limpio;
}

// -- Helper: truncar a ≤N chars respetando palabras ---------------------------
function truncarTitulo(titulo: string, maxLen: number = 60): string {
    if (titulo.length <= maxLen) return titulo;
    // Cortar en el último espacio antes del límite
    const sub = titulo.slice(0, maxLen);
    const lastSpace = sub.lastIndexOf(' ');
    return (lastSpace > maxLen * 0.6 ? sub.slice(0, lastSpace) : sub).trim();
}

// -- Helper: resolver datos con prioridad ficha → artículo --------------------
function resolvePublicationData(articulo: any, ficha: any | null) {
    return {
        nombre:              limpiarTitulo(ficha?.nombre_producto || articulo?.nombre),
        descripcion:         ficha?.descripcion_larga || ficha?.descripcion || articulo?.descripcion || '',
        marca:               ficha?.marca             || articulo?.marca,
        modelo:              ficha?.modelo            || articulo?.modelo,
        variante:            ficha?.variante          || articulo?.variante,
        pais_origen:         ficha?.pais_origen       || articulo?.pais_origen,
        categoria:           ficha?.categoria         || articulo?.categoria,
        codigo_universal:    ficha?.codigo_universal  || articulo?.codigo_universal,
        atributos_especificos: articulo?.atributos_especificos, // solo en articulos
        // Solo en ficha:
        bullet_points:       (ficha?.bullet_points as string[] | null | undefined) || [],
        palabras_clave:      ficha?.palabras_clave   || [],
        materiales:          ficha?.materiales        || null,
        atributos_categoria: ficha?.atributos_categoria || null, // pares {MLBATTR: 'valor'} de ficha
        // Dimensiones: ficha tiene prioridad, artículo como fallback
        peso_kg:  ficha?.peso_kg  ?? articulo?.peso_kg,
        largo_cm: ficha?.largo_cm ?? articulo?.largo_cm,
        ancho_cm: ficha?.ancho_cm ?? articulo?.ancho_cm,
        alto_cm:  ficha?.alto_cm  ?? articulo?.alto_cm,
    };
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    const trace: Record<string, any> = {}; // "tubo transparente" — cada paso deja su huella aquí

    try {
        // -- 0. Validar body ---------------------------------------------------
        const body = await req.json().catch(() => null);
        if (!body || !body.articulo_id || !body.marketplace_id) {
            return NextResponse.json({
                ok: false,
                error: 'Se requieren articulo_id y marketplace_id en el body',
            }, { status: 400 });
        }

        const {
            articulo_id,
            marketplace_id,
            pictures = [],
            ficha_id = null as string | null,
            category_id: category_id_override,
            listing_type_id = 'gold_special',
            dry_run = false,
            force_duplicate = false,
            attribute_overrides = [] as Array<{ id: string; value_name?: string; value_id?: string }>,
            family_name_override = null as string | null,
        } = body;

        trace.input = { articulo_id, marketplace_id, ficha_id, pictures_count: pictures.length, listing_type_id, dry_run };

        // -- 1. Leer artículo de BD --------------------------------------------
        const { data: articulo, error: artErr } = await supabaseAdmin
            .from('articulos')
            .select(`
                articulo_id, nombre, marca, modelo, variante,
                categoria, descripcion, codigo_universal,
                atributos_especificos, pais_origen,
                peso_kg, largo_cm, ancho_cm, alto_cm,
                activo, es_obsoleto, publicacion_ml
            `)
            .eq('articulo_id', articulo_id)
            .single();

        if (artErr || !articulo) {
            return NextResponse.json({
                ok: false,
                error: `Artículo no encontrado: ${artErr?.message}`,
                trace,
            }, { status: 404 });
        }

        trace.paso_1_articulo = {
            nombre: articulo.nombre,
            marca: articulo.marca,
            modelo: articulo.modelo,
            variante: articulo.variante,
            categoria: articulo.categoria,
            codigo_universal: articulo.codigo_universal,
            activo: articulo.activo,
            es_obsoleto: articulo.es_obsoleto,
            publicacion_ml_existente: articulo.publicacion_ml,
        };

        // -- 1b. Leer ficha técnica si se proveyó ficha_id ---------------------
        let fichaData: any = null;
        if (ficha_id) {
            const { data: ficha, error: fichaErr } = await supabaseAdmin
                .from('fichas_tecnicas')
                .select(`
                    id, nombre_producto, descripcion, descripcion_larga,
                    marca, modelo, variante, categoria, codigo_universal,
                    pais_origen, materiales,
                    peso_kg, largo_cm, ancho_cm, alto_cm,
                    bullet_points, palabras_clave,
                    atributos_categoria, articulo_id
                `)
                .eq('id', ficha_id)
                .single();

            if (fichaErr || !ficha) {
                trace.paso_1b_ficha = { advertencia: `ficha_id ${ficha_id} no encontrada — usando solo datos del artículo` };
            } else if (ficha.articulo_id && ficha.articulo_id !== articulo_id) {
                return NextResponse.json({
                    ok: false,
                    error: `La ficha ${ficha_id} pertenece al artículo ${ficha.articulo_id}, no a ${articulo_id}`,
                    trace,
                }, { status: 422 });
            } else {
                fichaData = ficha;
                trace.paso_1b_ficha = {
                    ficha_id,
                    nombre_producto: ficha.nombre_producto,
                    campos_con_datos: Object.entries(ficha)
                        .filter(([k, v]) => !['id','articulo_id'].includes(k) && v !== null && v !== undefined &&
                            !(Array.isArray(v) && v.length === 0) &&
                            !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0))
                        .map(([k]) => k),
                };
            }
        } else {
            trace.paso_1b_ficha = { omitido: 'No se proveyó ficha_id — usando datos del artículo' };
        }

        // Resolver datos con prioridad ficha → artículo
        const resolved = resolvePublicationData(articulo, fichaData);
        trace.paso_1b_resolved = {
            nombre_limpio:   resolved.nombre,
            descripcion_src: fichaData?.descripcion_larga ? 'ficha.descripcion_larga' : fichaData?.descripcion ? 'ficha.descripcion' : 'articulo.descripcion',
            peso_src:        fichaData?.peso_kg != null ? 'ficha' : 'articulo',
        };

        // Verificar publicabilidad básica
        if (!articulo.activo) {
            return NextResponse.json({ ok: false, error: 'El artículo no está activo', trace }, { status: 422 });
        }
        if (articulo.es_obsoleto) {
            return NextResponse.json({ ok: false, error: 'El artículo está marcado como obsoleto', trace }, { status: 422 });
        }
        if (articulo.publicacion_ml) {
            trace.paso_1_articulo.advertencia = `Ya tiene publicacion_ml: ${articulo.publicacion_ml}. Verificando estado real en BD...`;
        }

        // -- 1.5 Verificar duplicados activos en la misma cuenta ----------------
        // Fuente de verdad: publicaciones_externas + mapeo_publicacion_articulo
        // (NO articulo.publicacion_ml, que puede apuntar a un item ya cerrado)
        const { data: pubActiva } = await supabaseAdmin
            .from('publicaciones_externas')
            .select(`
                id, external_item_id, status_externo,
                mapeo_publicacion_articulo!inner (articulo_id)
            `)
            .eq('marketplace_id', marketplace_id)
            .eq('mapeo_publicacion_articulo.articulo_id', articulo_id)
            .in('status_externo', ['active', 'paused', 'under_review'])
            .limit(1)
            .maybeSingle();

        if (pubActiva && !force_duplicate) {
            return NextResponse.json({
                ok: false,
                error: `Ya existe una publicación activa para este artículo en esta cuenta: ${pubActiva.external_item_id} (status: ${pubActiva.status_externo}). Ciérrala primero o usa force_duplicate: true.`,
                publicacion_existente: pubActiva.external_item_id,
                trace,
            }, { status: 409 });
        }

        trace.paso_1_5_duplicado = pubActiva
            ? { advertencia: 'force_duplicate=true — publicando pese a existente', item_existente: pubActiva.external_item_id }
            : { ok: true, sin_duplicados: true };

        // -- 2. Detectar modelo del seller -------------------------------------
        // Soporta UP (family_name) y legacy (title). Tus cuentas son legacy.
        const meli = new MeliAdapter();
        const sellerInfo = await (meli as any).detectSellerModel(marketplace_id);
        trace.paso_2_seller_model = sellerInfo;
        const isLegacy = sellerInfo.model !== 'up';

        // -- 3. Obtener precio de marketplace_prices ---------------------------
        // marketplace_prices.articulo_id (renombrado desde sku en v47)
        let precio_data: any = null;
        const { data: precio } = await supabaseAdmin
            .from('marketplace_prices')
            .select('sale_price, base_price, currency, sku_tienda')
            .eq('articulo_id', articulo_id)
            .eq('marketplace_id', marketplace_id)
            .maybeSingle();
        precio_data = precio;

        // Si no hay precio específico por cuenta, buscar el más reciente sin filtro de cuenta
        if (!precio_data) {
            const { data: precioGeneral } = await supabaseAdmin
                .from('marketplace_prices')
                .select('sale_price, base_price, currency, sku_tienda, updated_at')
                .eq('articulo_id', articulo_id)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            precio_data = precioGeneral;
            if (precioGeneral) {
                trace.paso_3_precio_advertencia = 'Precio tomado de registro general (no específico de esta cuenta). Verificar.';
            }
        }

        trace.paso_3_precio = precio_data
            ? { sale_price: precio_data.sale_price, base_price: precio_data.base_price, currency: precio_data.currency }
            : { advertencia: 'No se encontró precio en marketplace_prices. Se usará 0 — CORREGIR antes de publicar en producción.', sale_price: 0 };

        let price = precio_data?.sale_price || 0;
        let priceSource: string = precio_data ? 'marketplace_prices' : 'none';

        // -- 3.1 Resolver SKU efectivo: marketplace_prices.sku_tienda > articulos.modelo --
        // articulos.sku fue eliminada permanentemente de la BD (DROP COLUMN CASCADE).
        // Guard anti-basura: descartar si es exactamente 8 chars hex (prefijo UUID legacy).
        const _SKU_BASURA = /^[0-9a-f]{8}$/i;
        const _raw_sku = precio_data?.sku_tienda || articulo.modelo || null;
        const sku_efectivo = (_raw_sku && _SKU_BASURA.test(_raw_sku)) ? null : _raw_sku;
        trace.paso_3_1_sku_efectivo = {
            origen: precio_data?.sku_tienda ? 'marketplace_prices.sku_tienda' : articulo.modelo ? 'articulos.modelo' : 'null',
            valor: sku_efectivo,
        };

        // -- 4. Calcular stock disponible --------------------------------------
        // inventory_snapshot.sku almacena articulo_id (migración V27)
        let stock = 0;
        let stockFailed = false;
        try {
            const { SKU_Service } = await import('@gestor/shared/sku-service');
            stock = await SKU_Service.calculateAvailableStock(articulo_id);
        } catch (stockErr: any) {
            stockFailed = true;
            // En dry_run permitimos continuar con stock=1 para inspection del trace
            // En publicación real esto se bloquea más abajo en validaciones
            stock = 1;
            trace.paso_4_stock = { error: `Fallo en calculateAvailableStock: ${stockErr.message}` };
        }
        trace.paso_4_stock = { ...trace.paso_4_stock, available_quantity: stock, stock_failed: stockFailed };

        // -- 5. Predecir o usar categoría --------------------------------------
        let category_id = category_id_override;
        let category_info: any = null;

        if (!category_id) {
            // Si la ficha tiene atributos_categoria con un mapping MeLi, intentar extraer category_id de ahí
            const fichaCategoria = resolved.atributos_categoria;
            if (fichaCategoria?.category_id) {
                category_id = fichaCategoria.category_id;
                category_info = { category_id, category_name: fichaCategoria.category_name || '', candidates: [], from_ficha: true };
            } else {
                // Query enriquecida con datos de la ficha
                const query = [
                    resolved.nombre, resolved.marca, resolved.modelo,
                    resolved.codigo_universal, resolved.categoria,
                ].filter(Boolean).join(' ').trim().slice(0, 100);
                category_info = await (meli as any).predictCategory(marketplace_id, query);
                category_id = category_info.category_id;
            }
        }

        // Enriquecer con ruta completa (Herramientas / Herramientas Manuales / Dados)
        let category_path = category_info?.category_name || '';
        try {
            const catR = await fetch(`https://api.mercadolibre.com/categories/${encodeURIComponent(category_id)}`);
            if (catR.ok) {
                const catData = await catR.json();
                const fromRoot: string = (catData.path_from_root || []).map((p: any) => p.name).join(' / ');
                if (fromRoot) category_path = fromRoot;
            }
        } catch { /* non-blocking */ }

        trace.paso_5_categoria = {
            category_id,
            category_name: category_info?.category_name || '(provisto manualmente)',
            category_path: category_path || category_info?.category_name || '',
            domain_id: category_info?.domain_id || null,
            candidates: category_info?.candidates || [],
            alternativas: category_info?.candidates || [],
        };

        // -- 5.1 Precio pre-publicación (Motor V2 orientado a proveedor) ---------
        // Usa la MISMA fórmula que post-publicación, resuelta antes de crear el item.
        // Si la RPC no está aplicada o no devuelve precio, cae a marketplace_prices.
        try {
            const { data: rpcPrice, error: rpcErr } = await supabaseAdmin.rpc('fn_calcular_precio_prepublicacion', {
                p_articulo_id:     articulo_id,
                p_marketplace_id:  marketplace_id,
                p_category_id:     category_id,
                p_listing_type_id: listing_type_id,
            });
            if (!rpcErr && rpcPrice?.sale_price != null && Number(rpcPrice.sale_price) > 0) {
                price = Number(rpcPrice.sale_price);
                priceSource = 'fn_calcular_precio_prepublicacion';
                trace.paso_5_1_precio_prepublicacion = rpcPrice;
            } else {
                trace.paso_5_1_precio_prepublicacion = rpcErr
                    ? { error: rpcErr.message, advertencia: 'Usando marketplace_prices como fallback' }
                    : { advertencia: 'RPC sin precio válido — usando marketplace_prices', rpc: rpcPrice };
            }
        } catch (e: any) {
            trace.paso_5_1_precio_prepublicacion = { error: e.message, advertencia: 'Usando marketplace_prices como fallback' };
        }


        // -- 6. Obtener atributos requeridos de la categoría -------------------
        const attrInfo = await (meli as any).getCategoryAttributes(marketplace_id, category_id);
        trace.paso_6_atributos = {
            total: attrInfo.raw.length,
            required_ids: attrInfo.required.map((a: any) => a.id),
            parent_pk_ids: attrInfo.parent_pk.map((a: any) => a.id),
            child_pk_ids: attrInfo.child_pk.map((a: any) => a.id),
            required_detail: attrInfo.required.map((a: any) => ({
                id: a.id,
                name: a.name,
                type: a.value_type,
                values: a.values?.slice(0, 50).map((v: any) => ({ id: v.id, name: v.name })) || [],
            })),
        };

        // -- 7. Construir attributes[] usando datos resueltos (ficha → artículo) -
        const attributes: Array<{ id: string; value_name?: string; value_id?: string }> = [];

        if (resolved.marca)            attributes.push({ id: 'BRAND',  value_name: resolved.marca });
        if (resolved.modelo)           attributes.push({ id: 'MODEL',  value_name: resolved.modelo });
        if (resolved.codigo_universal) attributes.push({ id: 'GTIN',   value_name: resolved.codigo_universal });
        if (sku_efectivo)              attributes.push({ id: 'SELLER_SKU', value_name: sku_efectivo });
        if (resolved.pais_origen)      attributes.push({ id: 'ORIGIN_COUNTRY', value_name: resolved.pais_origen });
        if (resolved.variante)         attributes.push({ id: 'COLOR',  value_name: resolved.variante });
        if (resolved.materiales)       attributes.push({ id: 'MATERIAL', value_name: resolved.materiales });

        // ITEM_CONDITION: 2230284 = Nuevo
        attributes.push({ id: 'ITEM_CONDITION', value_id: '2230284' });

        // Atributos de categoría de la ficha — fusionar como hints adicionales
        // Son pares { MLBATTR_ID: 'valor' } que el operador configuró en la ficha.
        // Se agregan SOLO si el atributo no fue ya mapeado arriba.
        const mappedIdsPre = new Set(attributes.map(a => a.id));
        if (resolved.atributos_categoria && typeof resolved.atributos_categoria === 'object') {
            for (const [attrId, attrVal] of Object.entries(resolved.atributos_categoria as Record<string, any>)) {
                if (attrId === 'category_id' || attrId === 'category_name') continue; // meta-campos
                if (!mappedIdsPre.has(attrId) && attrVal != null && attrVal !== '') {
                    attributes.push({ id: attrId, value_name: String(attrVal) });
                }
            }
        }

        // Dimensiones del paquete — prioridad ficha, fallback artículo
        const categoryAttrIds = new Set((attrInfo.raw || []).map((a: any) => a.id));
        const sellerPackageOmitidos: string[] = [];

        const maybePushPackage = (id: string, value_name: string, hasValue: boolean) => {
            if (!hasValue) return;
            if (categoryAttrIds.has(id)) {
                attributes.push({ id, value_name });
            } else {
                sellerPackageOmitidos.push(`${id} (no requerido por ${category_id})`);
            }
        };

        maybePushPackage('SELLER_PACKAGE_HEIGHT', `${Math.round(resolved.alto_cm  ?? 0)} cm`, !!resolved.alto_cm);
        maybePushPackage('SELLER_PACKAGE_WIDTH',  `${Math.round(resolved.ancho_cm ?? 0)} cm`, !!resolved.ancho_cm);
        maybePushPackage('SELLER_PACKAGE_LENGTH', `${Math.round(resolved.largo_cm ?? 0)} cm`, !!resolved.largo_cm);
        maybePushPackage('SELLER_PACKAGE_WEIGHT', `${Math.round((resolved.peso_kg ?? 0) * 1000)} g`, !!resolved.peso_kg);
        trace.paso_7_attributes_mapeados = attributes;
        trace.paso_7_package_dimensions = {
            SELLER_PACKAGE_HEIGHT: resolved.alto_cm  != null ? `${Math.round(resolved.alto_cm)} cm`             : null,
            SELLER_PACKAGE_WIDTH:  resolved.ancho_cm != null ? `${Math.round(resolved.ancho_cm)} cm`            : null,
            SELLER_PACKAGE_LENGTH: resolved.largo_cm != null ? `${Math.round(resolved.largo_cm)} cm`            : null,
            SELLER_PACKAGE_WEIGHT: resolved.peso_kg  != null ? `${Math.round(resolved.peso_kg * 1000)} g`       : null,
            fuente:                fichaData ? 'ficha_tecnica' : 'articulo',
            seller_package_omitidos: sellerPackageOmitidos,
        };


        // Atributos requeridos que NO pudimos mapear automáticamente
        const mappedIds = new Set(attributes.map(a => a.id));
        const unresolvedAttrs = attrInfo.required
            .filter((a: any) => !mappedIds.has(a.id))
            .map((a: any) => ({
                id:         a.id,
                name:       a.name,
                value_type: a.value_type || 'list',
                values:     (a.values || []).slice(0, 30).map((v: any) => ({ id: String(v.id), name: v.name })),
            }));
        trace.paso_7_atributos_faltantes = unresolvedAttrs.map((a: any) => ({ id: a.id, name: a.name }));

        // -- 8. GPT-4o-mini: family_name limpio + resolver atributos faltantes --
        const aiResult = await resolvePublicationAI({
            nombre:                 resolved.nombre || '',
            marca:                  resolved.marca  || '',
            modelo:                 resolved.modelo || '',
            descripcion:            resolved.descripcion,
            atributos_especificos:  resolved.atributos_especificos,
            unresolved_attributes:  unresolvedAttrs,
            max_family_name_chars:  isLegacy ? 60 : 50, // legacy: título completo; UP: family_name sin marca/modelo
            legacy:                 isLegacy,
        });
        // Limpiar family_name generado por AI también
        if (aiResult.family_name) {
            aiResult.family_name = truncarTitulo(limpiarTitulo(aiResult.family_name), 50);
        }

        // Construir mapa de valores permitidos por atributo para validación posterior
        const allowedValuesByAttr: Map<string, Set<string>> = new Map();
        for (const attr of attrInfo.required) {
            if (attr.values?.length > 0) {
                allowedValuesByAttr.set(attr.id, new Set(attr.values.map((v: any) => String(v.id))));
            }
        }

        // Filtrar atributos AI: descartar los que tengan value_id inválido para la categoría
        const validatedAIAttrs: typeof aiResult.attributes = [];
        const invalidAIAttrs: Array<{ id: string; value_id?: string; reason: string }> = [];
        for (const aiAttr of aiResult.attributes) {
            if (aiAttr.value_id && allowedValuesByAttr.has(aiAttr.id)) {
                if (!allowedValuesByAttr.get(aiAttr.id)!.has(String(aiAttr.value_id))) {
                    invalidAIAttrs.push({ ...aiAttr, reason: `value_id '${aiAttr.value_id}' no existe en los valores permitidos de ${aiAttr.id}` });
                    continue; // no incluir este atributo inválido
                }
            }
            validatedAIAttrs.push(aiAttr);
        }

        trace.paso_8_ai = {
            ai_used:          aiResult.ai_used,
            family_name:      aiResult.family_name,
            family_name_origen: aiResult.ai_used ? 'gpt-4o-mini' : 'fallback_nombre_truncado',
            tokens_used:      aiResult.tokens_used,
            attrs_resueltos:  validatedAIAttrs,
            attrs_descartados_invalidos: invalidAIAttrs,
            ...((!aiResult.ai_used) ? { advertencia_family_name: 'AI no disponible — family_name puede contener marca/modelo. Verificar antes de publicar.' } : {}),
        };

        // Fusionar: mapeados automáticos + AI validados (AI no sobreescribe los ya mapeados)
        const allAttributes = [
            ...attributes,
            ...validatedAIAttrs.filter(a => !mappedIds.has(a.id)),
        ];
        // Aplicar attribute_overrides del usuario (sobreescriben/adicionan tras el AI)
        if (attribute_overrides.length > 0) {
            for (const ov of attribute_overrides) {
                const idx = allAttributes.findIndex((a: any) => a.id === ov.id);
                if (idx !== -1) {
                    allAttributes[idx] = { ...allAttributes[idx], ...ov };
                } else {
                    allAttributes.push(ov);
                }
            }
            trace.paso_8_overrides_usuario = attribute_overrides;
        }

        trace.paso_8_attributes_final = allAttributes;

        // Atributos requeridos todavía faltantes después del AI
        const stillMissingIds = new Set(allAttributes.map((a: any) => a.id));
        const stillMissing = attrInfo.required
            .filter((a: any) => !stillMissingIds.has(a.id))
            .map((a: any) => ({ id: a.id, name: a.name }));
        trace.paso_8_atributos_aun_faltantes = stillMissing;

        // -- 9. Construir el body del POST /items (UP o legacy) -----------------
        // Construir descripción enriquecida con bullets (máx 2000 chars)
        const bulletsText = resolved.bullet_points.length > 0
            ? '\n\n' + resolved.bullet_points.map((b: string) => `• ${b}`).join('\n')
            : '';
        const descripcionCompleta = ((resolved.descripcion || '') + bulletsText).slice(0, 2000);

        // Título limpio final: override manual > AI > nombre resuelto (truncado ≤60 chars)
        const familyNameFinal = family_name_override
            ? truncarTitulo(limpiarTitulo(family_name_override), 60)
            : (aiResult.family_name || truncarTitulo(resolved.nombre, 60));

        // Título legacy: completo con marca + modelo (override manual > AI > compuesto)
        const titleLegacy = truncarTitulo(limpiarTitulo(
            family_name_override ||
            aiResult.title ||
            [resolved.marca, resolved.modelo, resolved.nombre].filter(Boolean).join(' ')
        ), 60);

        const itemBody: any = {
            category_id,
            price,
            currency_id: precio_data?.currency || 'MXN',
            available_quantity: Math.max(stock, 1),
            buying_mode: 'buy_it_now',
            listing_type_id,
            // legacy exige condition; UP lo deriva del catálogo
            ...(isLegacy ? { condition: 'new' } : {}),
            sale_terms: [
                { id: 'WARRANTY_TYPE', value_name: 'Garantía del vendedor' },
                { id: 'WARRANTY_TIME', value_name: '1 mes' },
            ],
            pictures: pictures.map((url: string) => ({ source: url })),
            attributes: allAttributes,
            // legacy: MeLi exige title (marca + modelo incluidos).
            // UP: MeLi genera el título desde family_name — no enviar title ni variations.
            ...(isLegacy ? { title: titleLegacy } : { family_name: familyNameFinal }),
        };
        trace.paso_9_titulo = {
            modelo_seller: isLegacy ? 'legacy' : 'up',
            title_legacy: isLegacy ? titleLegacy : null,
            family_name_up: isLegacy ? null : familyNameFinal,
            fuente: family_name_override ? 'override_manual' : aiResult.ai_used ? 'gpt_4o_mini' : 'compuesto',
            price_source: priceSource,
            price_final: price,
        };
        trace.paso_9_descripcion = { chars: descripcionCompleta.length, bullets: resolved.bullet_points.length };

        trace.paso_9_body = itemBody;

        // -- 10. Validaciones DURAS — errores 422 bloqueantes -----------------
        const erroresDuros: string[] = [];
        if (pictures.length === 0) erroresDuros.push('Sin imágenes: MeLi rechaza publicaciones sin pictures[]');
        if (price === 0)           erroresDuros.push('Precio = 0: MeLi rechazará la publicación');
        if (stillMissing.length > 0) {
            erroresDuros.push(
                `Atributos requeridos sin resolver después del AI: ${stillMissing.map((a: any) => a.id).join(', ')}`
            );
        }
        // Stock fallido solo bloquea en publicación real, no en dry_run
        if (stockFailed && !dry_run) {
            erroresDuros.push('No se pudo calcular el stock disponible. No se publicará con stock ficticio.');
        }
        // Validación anticipada de formato SELLER_PACKAGE_*:
        // MeLi (cause_id 5402) exige enteros en cm/g.
        // Solo validar los que sí pasaron el filtro de categoría y están en allAttributes[].
        const pkgFormatErrors: string[] = [];
        const SELLER_PKG_IDS = new Set(['SELLER_PACKAGE_HEIGHT','SELLER_PACKAGE_WIDTH','SELLER_PACKAGE_LENGTH','SELLER_PACKAGE_WEIGHT']);
        for (const attr of allAttributes) {
            if (!SELLER_PKG_IDS.has(attr.id) || !attr.value_name) continue;
            const num = parseInt(attr.value_name, 10);
            if (isNaN(num) || num <= 0) {
                pkgFormatErrors.push(`${attr.id}: valor '${attr.value_name}' no es un entero positivo válido`);
            }
        }
        if (pkgFormatErrors.length > 0) {
            erroresDuros.push(`Formato inválido en dimensiones de paquete: ${pkgFormatErrors.join('; ')}`);
        }

        if (erroresDuros.length > 0) {
            return NextResponse.json({
                ok: false,
                error: 'Validación fallida — corregir antes de publicar',
                errores: erroresDuros,
                duracion_ms: Date.now() - startTime,
                trace,
            }, { status: 422 });
        }

        // -- 11. DRY RUN — retornar sin publicar ------------------------------
        if (dry_run) {
            return NextResponse.json({
                ok: true,
                dry_run: true,
                mensaje: 'Simulación completada. Para publicar envía dry_run: false.',
                duracion_ms: Date.now() - startTime,
                trace,
            });
        }

        // -- 12. Publicar en MeLi ----------------------------------------------
        const created = await (meli as any).createItem(marketplace_id, itemBody);
        trace.paso_12_meli_create = {
            item_id:         created.item_id,
            user_product_id: created.user_product_id,
            family_id:       created.family_id,
            permalink:       created.permalink,
            title_generado:  created.title,
            status:          created.status,
        };
        trace.paso_12_meli_raw = created.raw; // respuesta completa de MeLi para inspección

        // -- 13. Agregar descripción (enriquecida con bullets, máx 2000 chars) --
        let descResult: any = null;
        if (descripcionCompleta) {
            descResult = await (meli as any).addDescription(marketplace_id, created.item_id, descripcionCompleta);
            trace.paso_13_descripcion = { ok: descResult.ok, chars: descripcionCompleta.length };
        } else {
            trace.paso_13_descripcion = { omitido: 'Sin descripción disponible (ni en ficha ni en artículo)' };
        }

        // -- 14. Guardar en BD: publicaciones_externas -------------------------
        const { data: pubInserted, error: pubErr } = await supabaseAdmin
            .from('publicaciones_externas')
            .upsert({
                marketplace_id,
                external_item_id:     created.item_id,
                external_variation_id: '0',
                titulo:               created.title,
                precio_venta:         price,
                stock_publicado:      Math.max(stock, 1),
                status_externo:       created.status,
                permalink:            created.permalink,
                listing_type_id,
                category_id,
                // tipo_publicacion derivado de la respuesta real de MeLi:
                // Si MeLi devuelve user_product_id, es un item del modelo User Products
                tipo_publicacion:     created.user_product_id ? 'up' : 'tradicional',
                es_fuente_stock:      true,
                actualizado_el:       new Date().toISOString(),
                // Campos del nuevo modelo UP
                ...(created.user_product_id ? { seller_sku: sku_efectivo || null } : {}),
            }, { onConflict: 'marketplace_id,external_item_id,external_variation_id' })
            .select('id')
            .single();

        trace.paso_14_publicaciones_externas = pubErr
            ? { error: pubErr.message }
            : { publicacion_id: pubInserted?.id };

        // -- 15. Guardar en BD: mapeo_publicacion_articulo ---------------------
        if (pubInserted?.id) {
            const { error: mapErr } = await supabaseAdmin
                .from('mapeo_publicacion_articulo')
                .upsert({
                    publicacion_id:    pubInserted.id,
                    articulo_id:       articulo_id,
                    cantidad_requerida: 1,
                }, { onConflict: 'publicacion_id,articulo_id' });

            trace.paso_15_mapeo = mapErr ? { error: mapErr.message } : { ok: true };


            // -- 16. Actualizar articulos.publicacion_ml -----------------------
            const { error: artUpdateErr } = await supabaseAdmin
                .from('articulos')
                .update({ publicacion_ml: created.item_id })
                .eq('articulo_id', articulo_id);

            trace.paso_16_articulo_update = artUpdateErr
                ? { error: artUpdateErr.message }
                : { publicacion_ml: created.item_id };

            // -- 17. Vincular fichas_tecnicas ← publicación (solo si vino ficha_id) --
            if (ficha_id) {
                const { error: fichaLinkErr } = await supabaseAdmin
                    .from('fichas_tecnicas')
                    .update({
                        publicacion_externa_id: pubInserted.id,
                        ml_item_id:             created.item_id,
                    })
                    .eq('id', ficha_id);

                trace.paso_17_ficha_vinculacion = fichaLinkErr
                    ? { error: fichaLinkErr.message }
                    : { ok: true, publicacion_externa_id: pubInserted.id, ml_item_id: created.item_id };
            } else {
                trace.paso_17_ficha_vinculacion = { omitido: 'No se proveyó ficha_id' };
            }
        }

        // -- Respuesta final ---------------------------------------------------
        return NextResponse.json({
            ok: true,
            item_id:         created.item_id,
            user_product_id: created.user_product_id,
            permalink:       created.permalink,
            title:           created.title,
            seller_model:    sellerInfo.model,
            duracion_ms:     Date.now() - startTime,
            trace,
        });

    } catch (err: any) {
        // Distinguir errores de validación de MeLi (400) de errores internos (500)
        // createItem relanza el error con el JSON de respuesta de MeLi en el mensaje
        const errMsg: string = err.message || '';
        let meliError: any = null;
        let isMeliValidation = false;

        if (errMsg.includes('400') || errMsg.includes('validation_error')) {
            try {
                // El mensaje contiene "MeLi 400: {...json...}" — extraer el JSON
                const jsonStart = errMsg.indexOf('{');
                if (jsonStart !== -1) {
                    meliError = JSON.parse(errMsg.slice(jsonStart));
                    isMeliValidation = true;
                }
            } catch { /* si no parsea, cae al 500 genérico */ }
        }

        if (isMeliValidation) {
            return NextResponse.json({
                ok: false,
                error: 'MeLi rechazó la publicación (validation_error)',
                meli_status: 400,
                meli_error: meliError,
                duracion_ms: Date.now() - startTime,
                trace,
            }, { status: 422 });
        }

        return NextResponse.json({
            ok: false,
            error: errMsg,
            duracion_ms: Date.now() - startTime,
            trace,
        }, { status: 500 });
    }
}
