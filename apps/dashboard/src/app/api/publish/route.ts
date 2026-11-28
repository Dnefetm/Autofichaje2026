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
import { registrarAuditoria } from '@/lib/auditoria';
import { checkPublishDuplicates, normalizeGtins, extractGtinCaps, checkConditionalGtinRequirement, mergeConditionalGtinCaps } from '@/lib/publish-duplicates';
import { extractFiscalFromMeliAttributes, FISCAL_ATTR_IDS, IVA_VALUE_IDS, IEPS_VALUE_IDS, isValidSatKey } from '@/lib/meli-fiscal';
import { toOriginalMeliUrl } from '@/lib/image-utils';
import sharp from 'sharp';

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
    // Pulgadas/comillas dobles → dos apóstrofos (MeLi elimina las comillas dobles).
    limpio = limpio.replace(/"/g, "''");
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

// -- Helper: resolver datos con prioridad ficha → manual → vidriera origen → artículo ---
function resolvePublicationData(articulo: any, ficha: any | null, source: any | null, manual: any | null = null) {
    const toNum = (v: any) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : undefined);
    return {
        nombre:              limpiarTitulo(ficha?.nombre_producto || manual?.nombre || source?.nombre || articulo?.nombre),
        descripcion:         ficha?.descripcion_larga || ficha?.descripcion || manual?.descripcion || source?.descripcion || articulo?.descripcion || '',
        marca:               ficha?.marca             || manual?.marca             || source?.marca             || articulo?.marca,
        modelo:              ficha?.modelo            || manual?.modelo            || source?.modelo            || articulo?.modelo,
        variante:            ficha?.variante          || manual?.variante          || source?.variante          || articulo?.variante,
        pais_origen:         ficha?.pais_origen       || manual?.pais_origen       || articulo?.pais_origen,
        categoria:           ficha?.categoria         || manual?.categoria         || source?.categoria         || articulo?.categoria,
        codigo_universal:    ficha?.codigo_universal  || manual?.codigo_universal  || source?.codigo_universal  || articulo?.codigo_universal,
        codigo_sat:          source?.codigo_sat       || articulo?.codigo_sat        || null,
        atributos_especificos: articulo?.atributos_especificos ?? null, // solo en articulos
        // Solo en ficha:
        bullet_points:       (ficha?.bullet_points as string[] | null | undefined) || [],
        palabras_clave:      ficha?.palabras_clave   || [],
        materiales:          ficha?.materiales        || null,
        atributos_categoria: ficha?.atributos_categoria || null, // pares {MLBATTR: 'valor'} de ficha
        // Dimensiones: ficha > manual > vidriera origen > artículo
        peso_kg:  ficha?.peso_kg  ?? toNum(manual?.peso_kg)  ?? source?.peso_kg  ?? articulo?.peso_kg,
        largo_cm: ficha?.largo_cm ?? toNum(manual?.largo_cm) ?? source?.largo_cm ?? articulo?.largo_cm,
        ancho_cm: ficha?.ancho_cm ?? toNum(manual?.ancho_cm) ?? source?.ancho_cm ?? articulo?.ancho_cm,
        alto_cm:  ficha?.alto_cm  ?? toNum(manual?.alto_cm)  ?? source?.alto_cm  ?? articulo?.alto_cm,
    };
}

/** Convierte las aplicaciones vehiculares de DAI al contrato de compatibilidades de MeLi (products_families). */
function buildCompatibilitiesFromAplicaciones(aplicaciones: any[] | null | undefined): { products_families: any[]; domain_id?: string } | null {
    if (!Array.isArray(aplicaciones) || aplicaciones.length === 0) return null;
    const DOMAIN = 'MLM-CARS_AND_VANS_FOR_COMPATIBILITIES';
    const families: any[] = [];
    const seen = new Set<string>();
    for (const a of aplicaciones) {
        const marca = String(a?.marca ?? '').trim();
        const modelo = String(a?.modelo ?? '').trim();
        if (!marca || !modelo) continue;
        const anioIni = parseInt(String(a?.anio ?? ''), 10);
        const anioFin = parseInt(String(a?.anioF ?? ''), 10);
        const anios: number[] = [];
        if (!isNaN(anioIni) && anioIni >= 1900 && anioIni <= 2100) {
            const fin = (!isNaN(anioFin) && anioFin >= anioIni && anioFin <= 2100) ? anioFin : anioIni;
            for (let y = anioIni; y <= fin && anios.length < 40; y++) anios.push(y);
        }
        if (anios.length === 0) anios.push(-1); // sin año
        for (const y of anios) {
            const key = `${marca}||${modelo}||${y}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const attributes: any[] = [
                { id: 'BRAND', value_name: marca },
                { id: 'CAR_AND_VAN_MODEL', value_name: modelo },
            ];
            if (y > 0) attributes.push({ id: 'YEAR', value_name: String(y) });
            families.push({ domain_id: DOMAIN, attributes });
        }
        if (families.length >= 200) break;
    }
    return families.length > 0 ? { products_families: families, domain_id: DOMAIN } : null;
}

/** Garantiza que una imagen cumpla el mínimo de MeLi (lado mayor >= 500px, menor >= 250px). */
async function ensureImageSize(url: string): Promise<string> {
    try {
        const res = await fetch(url);
        if (!res.ok) return url;
        const buf = Buffer.from(await res.arrayBuffer());
        const meta = await sharp(buf).metadata();
        let w = meta.width || 0;
        let h = meta.height || 0;
        if (!w || !h) return url;
        if (Math.max(w, h) >= 500 && Math.min(w, h) >= 250) return url; // ya cumple

        let pipeline = sharp(buf).flatten({ background: { r: 255, g: 255, b: 255 } });

        if (Math.max(w, h) < 400) {
            const s = Math.min(1.5, 500 / Math.max(w, h));
            w = Math.round(w * s);
            h = Math.round(h * s);
            pipeline = pipeline.resize(w, h, { kernel: 'lanczos3', fit: 'fill' }).sharpen({ sigma: 1.0, m1: 1.5, m2: 0.7 });
        }

        const isLandscape = w >= h;
        const targetW = isLandscape ? Math.max(w, 500) : Math.max(w, 250);
        const targetH = isLandscape ? Math.max(h, 250) : Math.max(h, 500);
        const padW = Math.max(0, targetW - w);
        const padH = Math.max(0, targetH - h);
        if (padW > 0 || padH > 0) {
            pipeline = pipeline.extend({
                top: Math.floor(padH / 2),
                bottom: padH - Math.floor(padH / 2),
                left: Math.floor(padW / 2),
                right: padW - Math.floor(padW / 2),
                background: { r: 255, g: 255, b: 255 },
            });
        }

        const out = await pipeline.jpeg({ quality: 95 }).toBuffer();
        const filename = `mejoras/pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error: upErr } = await supabaseAdmin.storage.from('ficha-imagenes').upload(filename, out, { contentType: 'image/jpeg', upsert: false });
        if (upErr) return url;
        return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/ficha-imagenes/${filename}`;
    } catch {
        return url;
    }
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    const trace: Record<string, any> = {}; // "tubo transparente" — cada paso deja su huella aquí

    try {
        // -- 0. Validar body ---------------------------------------------------
        const body = await req.json().catch(() => null);
        const _tieneArticulo = !!(body && body.articulo_id);
        const _tieneFuente = !!(body && body.source_marketplace_id && body.source_item_id);
        const _tieneManual = Boolean(body?.manual_product && typeof body.manual_product.nombre === 'string' && body.manual_product.nombre.trim().length > 0);
        if (!body || !body.marketplace_id || (!_tieneArticulo && !_tieneFuente && !_tieneManual)) {
            return NextResponse.json({
                ok: false,
                error: 'Se requieren marketplace_id y (articulo_id, source_marketplace_id+source_item_id, o manual_product.nombre) en el body',
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
            price_override = null as number | null,
            description_override = null as string | null,
            free_shipping = false as boolean,
            shipping_mode = 'me2' as string,
            manufacturing_time_days = null as number | null,
            catalog_product_id = null as string | null,
            catalog_listing = false as boolean,
            auto_search_catalog = false as boolean,
            force_rule_id = null as string | null,
            stock_override = null as number | null,
            cantidad_requerida = null as number | null,
            compatibilities = null as any,
            source_marketplace_id = null as string | null,
            source_item_id = null as string | null,
            fiscal_data = undefined as any,
            manual_product = null as any,
            register_in_catalog = false as boolean,
            create_paused = false as boolean,
            check_marketplace_ids = null as string[] | null,
            empty_gtin_reason = null as string | null,
            is_kit = false as boolean,
        } = body;

        let wantsZeroStock = stock_override != null && Number(stock_override) === 0;
        let wantsPaused = Boolean(create_paused) || wantsZeroStock;

        trace.input = {
            articulo_id: articulo_id ?? null,
            marketplace_id,
            ficha_id,
            pictures_count: pictures.length,
            listing_type_id,
            dry_run,
            source_marketplace_id: source_marketplace_id ?? null,
            source_item_id: source_item_id ?? null,
            manual_mode: _tieneManual,
            register_in_catalog: !!register_in_catalog,
            create_paused: !!create_paused,
            wants_paused: wantsPaused,
            empty_gtin_reason: empty_gtin_reason ?? null,
            is_kit: !!is_kit,
        };

        // -- 0.5 Fuente vidriera (copia adaptada entre cuentas) ----------------
        // Si se provee una vidriera origen, se lee su ítem completo desde MeLi y se
        // usa como fuente de datos, con prioridad: ficha técnica > manual > vidriera origen > artículo.
        const meli = new MeliAdapter();
        let resolvedArticuloId: string | null = articulo_id || null;
        let sourceItem: any = null;
        let sourceData: any = null;
        let sourcePackQty: number | null = null;

        if (source_marketplace_id && source_item_id) {
            try {
                sourceItem = await (meli as any).getItem(source_marketplace_id, source_item_id);
            } catch (e: any) {
                trace.paso_0_5_source = { error: `No se pudo leer la vidriera origen: ${e.message}` };
            }

            if (sourceItem) {
                let sourceDescription: string | null = null;
                try {
                    const sd = await (meli as any).getDescription(source_marketplace_id, source_item_id);
                    if (sd) sourceDescription = sd;
                } catch { /* best-effort */ }

                const attrVal = (id: string) =>
                    sourceItem.attributes?.find((a: any) => a.id === id)?.value_name ?? null;
                const dims = sourceItem.shipping?.dimensions || null;
                // Las dimensiones de paquete en MeLi suelen vivir en los atributos
                // SELLER_PACKAGE_* ("10 cm", "500 g"), no siempre en shipping.dimensions.
                const parseNum = (s: any) => {
                    const m = s == null ? null : String(s).match(/-?\d+(\.\d+)?/);
                    return m ? Number(m[0]) : null;
                };
                const pkgWeightG  = parseNum(attrVal('SELLER_PACKAGE_WEIGHT'));
                const pkgLengthCm = parseNum(attrVal('SELLER_PACKAGE_LENGTH'));
                const pkgWidthCm  = parseNum(attrVal('SELLER_PACKAGE_WIDTH'));
                const pkgHeightCm = parseNum(attrVal('SELLER_PACKAGE_HEIGHT'));
                // Fotos de la vidriera origen, preservando máxima calidad (-O.jpg) y el id oficial de MeLi
                // para reutilizarlas (evita re-descargar/re-subir en copia de condición).
                const sourcePics = (sourceItem.pictures || [])
                    .map((p: any) => ({ id: p.id || null, url: toOriginalMeliUrl(p.secure_url || p.url) }))
                    .filter((p: any) => p.url);

                sourceData = {
                    nombre:             sourceItem.family_name || sourceItem.title || '',
                    descripcion:        sourceDescription,
                    marca:              attrVal('BRAND'),
                    modelo:             attrVal('MODEL'),
                    variante:           attrVal('COLOR'),
                    codigo_universal:   attrVal('GTIN') || attrVal('EAN') || attrVal('UPC'),
                    codigo_sat:         attrVal('SAT_KEY'),
                    categoria:          sourceItem.category_id ?? null,
                    peso_kg:            dims?.weight != null ? Number(dims.weight) / 1000 : (pkgWeightG != null ? pkgWeightG / 1000 : null),
                    largo_cm:           dims?.length ?? pkgLengthCm,
                    ancho_cm:           dims?.width ?? pkgWidthCm,
                    alto_cm:            dims?.height ?? pkgHeightCm,
                    pictures:           sourcePics.map((p: any) => p.url),
                    picture_ids:        sourcePics.map((p: any) => p.id),
                    price:              sourceItem.price ?? null,
                    currency:           sourceItem.currency_id ?? null,
                    stock:              sourceItem.available_quantity ?? null,
                    listing_type_id:    sourceItem.listing_type_id ?? null,
                    seller_custom_field: sourceItem.seller_custom_field ?? null,
                    shipping:           sourceItem.shipping ?? null,
                    sale_terms:         sourceItem.sale_terms ?? null,
                    attributes:         sourceItem.attributes ?? [],
                    catalog_product_id: sourceItem.catalog_product_id ?? null,
                    catalog_listing:    sourceItem.catalog_listing === true,
                    condition:          sourceItem.condition ?? null,
                };

                trace.paso_0_5_source = {
                    item_id: sourceItem.id,
                    title: sourceItem.title ?? null,
                    family_name: sourceItem.family_name ?? null,
                    catalog_product_id: sourceItem.catalog_product_id ?? null,
                    category_id: sourceItem.category_id ?? null,
                    listing_type_id: sourceItem.listing_type_id ?? null,
                    price: sourceItem.price ?? null,
                    available_quantity: sourceItem.available_quantity ?? null,
                    pictures: sourceData.pictures.length,
                };
            }

            sourcePackQty = null;
            if (source_marketplace_id && source_item_id) {
                const { data: srcPub } = await supabaseAdmin
                    .from('publicaciones_externas')
                    .select('id')
                    .eq('marketplace_id', source_marketplace_id)
                    .eq('external_item_id', source_item_id)
                    .eq('external_variation_id', '0')
                    .limit(1)
                    .maybeSingle();

                if (srcPub?.id) {
                    const { data: srcMap } = await supabaseAdmin
                        .from('mapeo_publicacion_articulo')
                        .select('articulo_id, cantidad_requerida')
                        .eq('publicacion_id', srcPub.id)
                        .limit(1)
                        .maybeSingle();

                    if (srcMap?.cantidad_requerida) {
                        sourcePackQty = Number(srcMap.cantidad_requerida);
                    }
                    if (!resolvedArticuloId && srcMap?.articulo_id) {
                        resolvedArticuloId = srcMap.articulo_id;
                        trace.paso_0_5_articulo_resuelto = { desde: 'mapeo_origen', articulo_id: resolvedArticuloId, cantidad_requerida: sourcePackQty };
                    }
                }
            }

            if (!resolvedArticuloId && !sourceData && !_tieneManual) {
                return NextResponse.json({
                    ok: false,
                    error: 'No se pudo leer la vidriera origen y no se proveyó articulo_id ni manual_product',
                    trace,
                }, { status: 422 });
            }
        }

        // -- 1. Leer artículo de BD (opcional si publica desde 0 o copia sin mapeo)
        let articulo: any = null;
        if (resolvedArticuloId) {
            const { data: artRow, error: artErr } = await supabaseAdmin
                .from('articulos')
                .select(`
                    articulo_id, nombre, marca, modelo, variante,
                    categoria, descripcion, codigo_universal, codigo_sat,
                    atributos_especificos, pais_origen,
                    peso_kg, largo_cm, ancho_cm, alto_cm,
                    activo, es_obsoleto, publicacion_ml
                `)
                .eq('articulo_id', resolvedArticuloId)
                .single();

            if (artErr || !artRow) {
                return NextResponse.json({
                    ok: false,
                    error: `Artículo no encontrado: ${artErr?.message}`,
                    trace,
                }, { status: 404 });
            }
            articulo = artRow;

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
        } else {
            const parseOptNum = (v: any) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null);
            articulo = {
                articulo_id: null,
                nombre: manual_product?.nombre?.trim() || sourceData?.nombre || '',
                marca: manual_product?.marca?.trim() || sourceData?.marca || null,
                modelo: manual_product?.modelo?.trim() || sourceData?.modelo || null,
                variante: manual_product?.variante?.trim() || sourceData?.variante || null,
                categoria: manual_product?.categoria?.trim() || sourceData?.categoria || null,
                descripcion: manual_product?.descripcion?.trim() || sourceData?.descripcion || null,
                codigo_universal: manual_product?.codigo_universal?.trim() || sourceData?.codigo_universal || null,
                codigo_sat: null,
                atributos_especificos: null,
                pais_origen: manual_product?.pais_origen?.trim() || null,
                peso_kg: parseOptNum(manual_product?.peso_kg),
                largo_cm: parseOptNum(manual_product?.largo_cm),
                ancho_cm: parseOptNum(manual_product?.ancho_cm),
                alto_cm: parseOptNum(manual_product?.alto_cm),
                activo: true,
                es_obsoleto: false,
                publicacion_ml: null,
            };
            trace.paso_1_articulo = {
                modo: sourceData ? 'copia_sin_catalogo' : 'desde_cero',
                sin_catalogo: true,
                nombre: articulo.nombre,
                marca: articulo.marca,
                modelo: articulo.modelo,
                codigo_universal: articulo.codigo_universal,
            };
        }

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
            } else if (ficha.articulo_id && resolvedArticuloId && ficha.articulo_id !== resolvedArticuloId) {
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

        // Resolver datos con prioridad ficha → manual → vidriera origen → artículo
        const resolved = resolvePublicationData(articulo, fichaData, sourceData, manual_product);
        trace.paso_1b_resolved = {
            nombre_limpio:   resolved.nombre,
            descripcion_src: fichaData?.descripcion_larga ? 'ficha.descripcion_larga' : fichaData?.descripcion ? 'ficha.descripcion' : manual_product?.descripcion ? 'manual_product.descripcion' : 'articulo.descripcion',
            peso_src:        fichaData?.peso_kg != null ? 'ficha' : manual_product?.peso_kg != null ? 'manual_product' : 'articulo',
        };

        // Verificar publicabilidad básica
        if (resolvedArticuloId && !articulo.activo) {
            return NextResponse.json({ ok: false, error: 'El artículo no está activo', trace }, { status: 422 });
        }
        if (resolvedArticuloId && articulo.es_obsoleto) {
            return NextResponse.json({ ok: false, error: 'El artículo está marcado como obsoleto', trace }, { status: 422 });
        }
        if (articulo.publicacion_ml) {
            trace.paso_1_articulo.advertencia = `Ya tiene publicacion_ml: ${articulo.publicacion_ml}. Verificando estado real en BD...`;
        }

        // -- 1.4 Reconciliar estado real de publicaciones enlazadas -------------
        // MeLi es la fuente de verdad: si el usuario eliminó un item, lo marcamos
        // "closed" localmente para que no bloquee una nueva publicación.
        if (resolvedArticuloId) {
            try {
                const { data: linkedPubs } = await supabaseAdmin
                    .from('mapeo_publicacion_articulo')
                    .select('publicacion_id, publicaciones_externas!inner(external_item_id, status_externo)')
                    .eq('articulo_id', resolvedArticuloId)
                    .eq('publicaciones_externas.marketplace_id', marketplace_id);

            const staleIds = (linkedPubs || [])
                .filter((m: any) => ['active', 'paused', 'under_review'].includes(m.publicaciones_externas?.status_externo))
                .map((m: any) => (m.publicaciones_externas as any)?.external_item_id)
                .filter(Boolean);

            // external_item_id -> publicacion_id (para el fallback de desligue si el UPDATE falla)
            const pubIdByItemId = new Map<string, string>();
            for (const m of (linkedPubs || [])) {
                const extId: string | undefined = (m.publicaciones_externas as any)?.external_item_id;
                if (extId && m.publicacion_id) pubIdByItemId.set(extId, m.publicacion_id);
            }

            if (staleIds.length > 0) {
                const statusMap = await (meli as any).getStockAndStatusBatch(marketplace_id, staleIds);
                let cerradas = 0;
                const cerradasDetalle: string[] = [];
                for (const itemId of staleIds) {
                    const st = (statusMap as Map<string, { qty: number; status: string; sub_status: string[] }>).get(itemId);

                    let nuevoStatus: string | null = null;
                    let nuevoSubStatus: string[] = [];

                    if (st) {
                        if (['closed', 'inactive', 'deleted'].includes(st.status)) {
                            nuevoStatus = st.status;
                            nuevoSubStatus = st.sub_status || [];
                        }
                    } else {
                        // No está en el batch → puede estar ELIMINADO (404) o ser un fallo puntual del chunk.
                        // Confirmar con GET individual para no marcar erróneamente un item vivo.
                        try {
                            const itemStatus = await (meli as any).getItemStatus(marketplace_id, itemId);
                            if (!itemStatus.exists) {
                                nuevoStatus = 'closed';
                                nuevoSubStatus = ['deleted'];
                            } else if (['closed', 'inactive', 'deleted'].includes(itemStatus.status)) {
                                nuevoStatus = itemStatus.status;
                                nuevoSubStatus = [];
                            }
                        } catch {
                            // 401/429/red → no tocar este item (asumir que sigue vivo)
                        }
                    }

                    if (nuevoStatus) {
                        const { error: updErr } = await supabaseAdmin
                            .from('publicaciones_externas')
                            .update({ status_externo: nuevoStatus, sub_status: nuevoSubStatus, actualizado_el: new Date().toISOString() })
                            .eq('marketplace_id', marketplace_id)
                            .eq('external_item_id', itemId);

                        if (updErr) {
                            // Fallback: si el UPDATE falla (p.ej. trigger roto por columna renombrada),
                            // desligar el mapeo para que el anti-duplicados (paso 1.5) no bloquee.
                            const pubId = pubIdByItemId.get(itemId);
                            if (pubId) {
                                const { error: delErr } = await supabaseAdmin
                                    .from('mapeo_publicacion_articulo')
                                    .delete()
                                    .eq('publicacion_id', pubId)
                                    .eq('articulo_id', resolvedArticuloId);
                                trace.paso_1_4_fallback = {
                                    itemId,
                                    update_error: updErr.message,
                                    mapeo_desligado: !delErr,
                                };
                            }
                        }
                        cerradas++;
                        cerradasDetalle.push(itemId);
                    }
                }
                trace.paso_1_4_reconciliacion = { revisados: staleIds.length, cerradas, cerradas_detalle: cerradasDetalle };
            } else {
                trace.paso_1_4_reconciliacion = { revisados: 0 };
            }
            } catch (e: any) {
                trace.paso_1_4_reconciliacion = { error: e.message };
            }
        } else {
            trace.paso_1_4_reconciliacion = { omitido: 'Publicación sin articulo_id' };
        }

        // Helpers de identificación temprana (overrides + datos resueltos)
        const _findOverride = (ids: string[]) =>
            (attribute_overrides || []).find((o: any) => ids.includes(o.id))?.value_name?.trim() || '';
        const _ovGtin   = _findOverride(['GTIN', 'EAN', 'UPC']);
        const _ovSku    = _findOverride(['SELLER_SKU']);
        const _ovMarca  = _findOverride(['BRAND']);
        const _ovModelo = _findOverride(['MODEL']);
        const _SKU_BASURA = /^[0-9a-f]{8}$/i;

        // -- 1.5 Verificar duplicados activos (semáforo 3 niveles por cuenta) -----
        // Evalúa free / warning (distinto listing_type, distinto pack o GTIN compartido)
        // / exact (mismo producto/SKU + mismo listing_type).
        const targetAccountsForDupCheck = (dry_run && Array.isArray(check_marketplace_ids) && check_marketplace_ids.length > 0)
            ? Array.from(new Set(check_marketplace_ids.filter(Boolean)))
            : [marketplace_id];

        const dupGtinsParsed = normalizeGtins(
            empty_gtin_reason ? '' : (_ovGtin || resolved.codigo_universal || ''),
        );
        const reqPackQty = Math.max(1, Number(cantidad_requerida ?? (body as any)?.pack_quantity ?? sourcePackQty ?? 1));
        const checkSkuRaw = (_ovSku || manual_product?.sku || sourceData?.seller_custom_field || resolved.modelo || '').trim();

        const dupByAccountMap = await checkPublishDuplicates(supabaseAdmin, {
            marketplace_ids: targetAccountsForDupCheck,
            articulo_id: resolvedArticuloId,
            seller_sku: checkSkuRaw,
            gtins: dupGtinsParsed.list,
            listing_type_id,
            cantidad_requerida: reqPackQty,
        });

        const acctDup = dupByAccountMap[marketplace_id];
        const esCopia = Boolean(source_item_id);
        if (acctDup?.level === 'exact' && !force_duplicate && !dry_run && !esCopia) {
            const m = acctDup.matches[0];
            return NextResponse.json({
                ok: false,
                error: `Duplicado exacto en esta cuenta: ya existe ${m.external_item_id} (${m.status_externo}, ${m.listing_type_id || listing_type_id}${m.seller_sku ? `, SKU ${m.seller_sku}` : ''}). Confirma explícitamente si deseas duplicarla.`,
                publicacion_existente: m.external_item_id,
                duplicado: m,
                trace,
            }, { status: 409 });
        }

        const nonFreeEntries = Object.values(dupByAccountMap).filter(s => s.level !== 'free');
        const firstDupMatch = acctDup?.matches[0] || nonFreeEntries[0]?.matches[0] || null;
        trace.paso_1_5_duplicado = firstDupMatch
            ? {
                level: acctDup?.level || nonFreeEntries[0].level,
                advertencia: acctDup?.summary || nonFreeEntries[0].summary,
                item_existente: firstDupMatch.external_item_id,
                status: firstDupMatch.status_externo,
                seller_sku: firstDupMatch.seller_sku,
                by_account: dupByAccountMap,
                por_cuenta: nonFreeEntries.map(s => ({
                    marketplace_id: s.marketplace_id,
                    level: s.level,
                    item_existente: s.matches[0].external_item_id,
                    status: s.matches[0].status_externo,
                    seller_sku: s.matches[0].seller_sku,
                })),
            }
            : { ok: true, level: 'free', sin_duplicados: true, by_account: dupByAccountMap, por_cuenta: [] };

        // -- 2. Detectar modelo del seller -------------------------------------
        // Soporta UP (family_name) y legacy (title).
        const sellerInfo = await (meli as any).detectSellerModel(marketplace_id);
        trace.paso_2_seller_model = sellerInfo;
        const isLegacy = sellerInfo.model !== 'up';

        // -- 3. Obtener precio de marketplace_prices ---------------------------
        // marketplace_prices.articulo_id (renombrado desde sku en v47)
        let precio_data: any = null;
        if (resolvedArticuloId) {
            const { data: precio } = await supabaseAdmin
                .from('marketplace_prices')
                .select('sale_price, base_price, currency, sku_tienda')
                .eq('articulo_id', resolvedArticuloId)
                .eq('marketplace_id', marketplace_id)
                .maybeSingle();
            precio_data = precio;

            // Si no hay precio específico por cuenta, buscar el más reciente sin filtro de cuenta
            if (!precio_data) {
                const { data: precioGeneral } = await supabaseAdmin
                    .from('marketplace_prices')
                    .select('sale_price, base_price, currency, sku_tienda, updated_at')
                    .eq('articulo_id', resolvedArticuloId)
                    .order('updated_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                precio_data = precioGeneral;
                if (precioGeneral) {
                    trace.paso_3_precio_advertencia = 'Precio tomado de registro general (no específico de esta cuenta). Verificar.';
                }
            }
        }

        trace.paso_3_precio = precio_data
            ? { sale_price: precio_data.sale_price, base_price: precio_data.base_price, currency: precio_data.currency }
            : { advertencia: 'No se encontró precio en marketplace_prices. Se usará 0 — CORREGIR antes de publicar en producción.', sale_price: 0 };

        let price = precio_data?.sale_price || 0;
        let priceSource: string = precio_data ? 'marketplace_prices' : 'none';

        // Copia desde vidriera: si no hay precio en BD, heredar el precio de la vidriera origen.
        if (price === 0 && sourceData?.price != null && Number(sourceData.price) > 0) {
            price = Number(sourceData.price);
            priceSource = 'source_vidriera';
        }

        // -- 3.1 Resolver SKU efectivo: marketplace_prices.sku_tienda > manual/override > articulos.modelo --
        // Guard anti-basura: descartar si es exactamente 8 chars hex (prefijo UUID legacy).
        const _raw_sku = precio_data?.sku_tienda || _ovSku || manual_product?.sku || sourceData?.seller_custom_field || resolved.modelo || null;
        const sku_efectivo = (_raw_sku && _SKU_BASURA.test(_raw_sku)) ? null : _raw_sku;
        trace.paso_3_1_sku_efectivo = {
            origen: precio_data?.sku_tienda ? 'marketplace_prices.sku_tienda'
                : _ovSku ? 'override_manual'
                : manual_product?.sku ? 'manual_product.sku'
                : sourceData?.seller_custom_field ? 'vidriera_origen.seller_custom_field'
                : resolved.modelo ? 'articulos.modelo'
                : 'null',
            valor: sku_efectivo,
        };

        const sourceIsFulfillment = (sourceData?.shipping?.logistic_type === 'fulfillment') || (sourceItem?.shipping?.logistic_type === 'fulfillment');

        // -- 4. Calcular stock disponible --------------------------------------
        // inventory_snapshot.sku almacena articulo_id (migración V27).
        // Si el proveedor tiene política de stock (fijo/proveedor), tiene prioridad.
        let stock = 0;
        let stockFailed = false;
        let stockOrigen = 'fisico';
        if (resolvedArticuloId) {
            try {
                const { data: stockPol } = await supabaseAdmin.rpc('fn_stock_publicable', { p_articulo_id: resolvedArticuloId });
                if (stockPol && stockPol.modo && stockPol.stock != null) {
                    stock = Number(stockPol.stock) || 0;
                    stockOrigen = String(stockPol.modo);
                } else {
                    const { SKU_Service } = await import('@gestor/shared/sku-service');
                    stock = await SKU_Service.calculateAvailableStock(resolvedArticuloId);
                }
            } catch (stockErr: any) {
                stockFailed = true;
                // En dry_run permitimos continuar con stock=1 para inspection del trace
                // En publicación real esto se bloquea más abajo en validaciones
                stock = 1;
                trace.paso_4_stock = { error: `Fallo en stock: ${stockErr.message}` };
            }
        } else {
            if (sourceIsFulfillment) {
                stock = 0;
                stockOrigen = 'full_guard_sin_articulo';
            } else {
                stock = sourceData?.stock != null ? Number(sourceData.stock) : 1;
                stockOrigen = sourceData?.stock != null ? 'source_vidriera' : 'default_desde_cero';
            }
        }
        trace.paso_4_stock = { ...trace.paso_4_stock, available_quantity: stock, stock_failed: stockFailed, origen: stockOrigen };

        // -- 5. Predecir o usar categoría --------------------------------------
        // Copia desde vidriera: heredar la categoría de la vidriera origen si no se indicó otra.
        let category_id = category_id_override || sourceData?.categoria || undefined;
        let category_info: any = sourceData?.categoria
            ? { category_id, category_name: '', candidates: [], from_source: true }
            : null;

        if (!category_id) {
            // Si la ficha tiene atributos_categoria con un mapping MeLi, intentar extraer category_id de ahí
            const fichaCategoria = resolved.atributos_categoria;
            if (fichaCategoria?.category_id) {
                category_id = fichaCategoria.category_id;
                category_info = { category_id, category_name: fichaCategoria.category_name || '', candidates: [], from_ficha: true };
            } else {
                // Query enriquecida con datos de la ficha
                let query = [
                    resolved.nombre, resolved.marca, resolved.modelo,
                    resolved.codigo_universal, resolved.categoria,
                ].filter(Boolean).join(' ').trim().slice(0, 100);
                
                try {
                    category_info = await (meli as any).predictCategory(marketplace_id, query);
                } catch (e: any) {
                    // Si el query largo falla (ej. demasiados datos), intentar con uno corto
                    if (e.message.includes('no devolvió categorías')) {
                        const queryCorto = resolved.nombre.slice(0, 80).trim();
                        category_info = await (meli as any).predictCategory(marketplace_id, queryCorto);
                    } else {
                        throw e;
                    }
                }
                category_id = category_info.category_id;
            }
        }

        // Enriquecer con ruta completa + domain_id + detección automotriz
        let category_path = category_info?.category_name || '';
        let catDomainId: string | null = category_info?.domain_id || null;
        let isAutomotiveCategory = false;
        try {
            const catR = await fetch(`https://api.mercadolibre.com/categories/${encodeURIComponent(category_id)}`);
            if (catR.ok) {
                const catData = await catR.json();
                const pathArr: any[] = catData.path_from_root || [];
                const fromRoot: string = pathArr.map((p: any) => p.name).join(' / ');
                if (fromRoot) category_path = fromRoot;
                if (catData.settings?.catalog_domain || catData.domain_id) {
                    catDomainId = catData.settings?.catalog_domain || catData.domain_id;
                }
                isAutomotiveCategory = pathArr.some((p: any) => p.id === 'MLM1747')
                    || /^(MLM-)?(VEHICLE|CAR|AUTO|MOTORCYCLE)/i.test(String(catDomainId || ''));
            }
        } catch { /* non-blocking */ }

        trace.paso_5_categoria = {
            category_id,
            category_name: category_info?.category_name || '(provisto manualmente)',
            category_path: category_path || category_info?.category_name || '',
            domain_id: catDomainId,
            es_automotriz: isAutomotiveCategory,
            candidates: category_info?.candidates || [],
            alternativas: category_info?.candidates || [],
        };

        // Cantidad de piezas del paquete. Se multiplica el COSTO base (no el precio de venta)
        // para que el envío fijo se cobre una sola vez y el precio de pack sea correcto.
        const effectivePackQty = Math.max(1, Number(cantidad_requerida ?? (body as any)?.pack_quantity ?? sourcePackQty ?? 1));

        // -- 5.1 Precio pre-publicación (Motor V2 orientado a proveedor) ---------
        // Usa la MISMA fórmula que post-publicación, resuelta antes de crear el item.
        // Si la RPC no está aplicada o no devuelve precio, cae a marketplace_prices.
        if (resolvedArticuloId) {
            try {
                const { data: rpcPrice, error: rpcErr } = await supabaseAdmin.rpc('fn_calcular_precio_prepublicacion', {
                    p_articulo_id:     resolvedArticuloId,
                    p_marketplace_id:  marketplace_id,
                    p_category_id:     category_id,
                    p_listing_type_id: listing_type_id,
                    p_cantidad_requerida: effectivePackQty,
                    ...(force_rule_id ? { p_force_rule_id: force_rule_id } : {}),
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
        } else {
            trace.paso_5_1_precio_prepublicacion = { omitido: 'Publicación sin articulo_id (usar precio manual)' };
        }

        // -- 5.2 Precio manual: el operador puede fijar el precio (override) ---
        if (price_override != null && Number(price_override) > 0) {
            price = Number(price_override);
            priceSource = 'manual_override';
            trace.paso_5_2_precio_manual = { price, nota: 'Precio fijado manualmente por el operador' };
        }

        // -- 5.3 Stock: override manual > guardia Full / stock físico real > fuente no-Full sin artículo --
        if (stock_override != null && Number(stock_override) >= 0) {
            stock = Number(stock_override);
            stockFailed = false; // el operador fijó el stock manualmente: no bloquear por fallo de cálculo
            trace.paso_5_3_stock_manual = { stock, nota: 'Stock fijado manualmente por el operador' };
        } else if (sourceIsFulfillment) {
            if (!resolvedArticuloId || stockFailed) stock = 0;
            if (stock <= 0) {
                stock = 0;
                wantsZeroStock = true;
                wantsPaused = true;
            }
            trace.paso_5_3_full_guard = {
                activo: true,
                stock_local: stock,
                pausada_automatica: wantsPaused,
                nota: 'Origen en Mercado Envíos Full: stock de bodega MeLi no heredable a otra cuenta',
            };
        } else if (!resolvedArticuloId && sourceData?.stock != null && Number(sourceData.stock) >= 0) {
            stock = Number(sourceData.stock);
            trace.paso_5_3_stock_source = { stock, nota: 'Stock copiado de la vidriera origen' };
        }
        if (wantsPaused) {
            trace.paso_5_3_pausada = {
                solicitada: true,
                stock_cero: wantsZeroStock,
                nota: 'MeLi exige >=1 al crear; se pausará inmediatamente tras publicar',
            };
        }

        // Enlace a catálogo efectivo (se resuelve aquí para incluir catalog_required en el paso 6)
        const allowSourceCatalog = !empty_gtin_reason && body.catalog_listing !== false;
        let effectiveCatalogProductId: string | null = catalog_product_id
            || (allowSourceCatalog ? sourceData?.catalog_product_id : null)
            || null;
        let effectiveCatalogListing: boolean = !!(catalog_listing || effectiveCatalogProductId);

        // -- 5.4 Auto-búsqueda de Catálogo MeLi por GTIN (cuando la fuente es solo tradicional o viene lote) --
        if (allowSourceCatalog && !effectiveCatalogProductId && (auto_search_catalog || (catalog_listing && !catalog_product_id))) {
            const autoCatGtinParsed = normalizeGtins(_ovGtin || resolved.codigo_universal || '');
            if (autoCatGtinParsed.list.length === 1) {
                const targetGtin = autoCatGtinParsed.list[0];
                try {
                    const catSearch = await (meli as any).searchCatalog(marketplace_id, targetGtin);
                    const resultsList: any[] = Array.isArray(catSearch?.results) ? catSearch.results : [];
                    let autoMatchedCatalogId: string | null = null;
                    if (resultsList.length === 1 && resultsList[0]?.id) {
                        autoMatchedCatalogId = String(resultsList[0].id);
                    } else if (resultsList.length > 1) {
                        const exact = resultsList.find((r: any) =>
                            Array.isArray(r?.attributes) && r.attributes.some((a: any) =>
                                (a?.id === 'GTIN' || a?.id === 'EAN' || a?.id === 'UPC') &&
                                String(a?.value_name ?? '').replace(/\D/g, '') === targetGtin,
                            ),
                        );
                        if (exact?.id) autoMatchedCatalogId = String(exact.id);
                    }
                    if (autoMatchedCatalogId) {
                        effectiveCatalogProductId = autoMatchedCatalogId;
                        effectiveCatalogListing = true;
                    }
                    trace.paso_5_4_auto_catalog_search = {
                        gtin: targetGtin,
                        candidatos: resultsList.length,
                        catalog_product_id: autoMatchedCatalogId,
                    };
                } catch (catErr: any) {
                    trace.paso_5_4_auto_catalog_search = {
                        gtin: targetGtin,
                        error: catErr?.message || String(catErr),
                    };
                }
            }
        }

        // -- 6. Obtener atributos requeridos de la categoría -------------------
        const attrInfo = await (meli as any).getCategoryAttributes(marketplace_id, category_id);
        const baseRequiredAttrs: any[] = attrInfo.required || [];
        const catalogRequiredAttrs: any[] = effectiveCatalogListing
            ? (attrInfo.catalog_required || []).filter((ca: any) => !baseRequiredAttrs.some((r: any) => r.id === ca.id))
            : [];
        const effectiveRequiredAttrs: any[] = [...baseRequiredAttrs, ...catalogRequiredAttrs];

        // Atributos secundarios/opcionales rellenables (excluye ocultos y de sistema)
        const FILLABLE_TYPES = new Set(['list', 'string', 'boolean', 'number', 'number_unit']);
        // Excluir atributos fiscales/admin/sistema: NO son características del producto.
        const SKIP_OPT_IDS = new Set([
            'SIZE_GRID_ID', 'EXCLUSIVE_CHANNEL', 'ITEM_CONDITION', 'SELLER_CUSTOM_FIELD',
            'SELLER_SKU', 'GTIN', 'EAN', 'UPC', 'BRAND', 'MODEL', 'EMPTY_GTIN_REASON', 'IS_KIT',
            'SAT_KEY', 'MEASURE_UNIT_KEY', 'MEASURE_UNIT_DESCRIPTION',
            'IMPORT_DECLARATION_NUMBER', 'INVOICE_PRODUCT_NAME',
            'IVA_FOR_RESALE', 'IEPS', 'SALE_FORMAT', 'UNITS_PER_PACK',
        ]);
        const baseGtinCaps = extractGtinCaps(attrInfo.raw || []);
        const brandForCond = (_ovMarca || resolved.marca || '').trim() || null;
        const gtinCaps = baseGtinCaps.has_empty_reason
            ? mergeConditionalGtinCaps(
                baseGtinCaps,
                brandForCond,
                await checkConditionalGtinRequirement({
                    category_id,
                    brand: brandForCond,
                    listing_type_id,
                    empty_gtin_reason,
                }),
            )
            : baseGtinCaps;
        const optionalAttrs = (attrInfo.optional || [])
            .filter((a: any) => FILLABLE_TYPES.has(a.value_type) && !SKIP_OPT_IDS.has(a.id) && !(a.tags || {}).hidden)
            .slice(0, 40);
        trace.paso_6_atributos = {
            total: attrInfo.raw.length,
            gtin_caps: gtinCaps,
            required_ids: effectiveRequiredAttrs.map((a: any) => a.id),
            catalog_required_ids: catalogRequiredAttrs.map((a: any) => a.id),
            parent_pk_ids: attrInfo.parent_pk.map((a: any) => a.id),
            child_pk_ids: attrInfo.child_pk.map((a: any) => a.id),
            optional_ids: optionalAttrs.map((a: any) => a.id),
            required_detail: effectiveRequiredAttrs.map((a: any) => ({
                id: a.id,
                name: a.name,
                type: a.value_type,
                values: a.values?.slice(0, 50).map((v: any) => ({ id: v.id, name: v.name })) || [],
            })),
            optional_detail: optionalAttrs.map((a: any) => ({
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
        // PART_NUMBER: prioridad al override manual del panel (MODEL/PART_NUMBER), luego modelo/SKU.
        // Solo si la categoría reconoce PART_NUMBER (evita rechazos en otras categorías).
        const overridePartNumber = (attribute_overrides || []).find((o: any) => o.id === 'PART_NUMBER' || o.id === 'MODEL')?.value_name;
        const partNumberEfectivo = overridePartNumber || resolved.modelo || sku_efectivo;
        if (partNumberEfectivo && (attrInfo?.raw || []).some((a: any) => a.id === 'PART_NUMBER')) {
            attributes.push({ id: 'PART_NUMBER', value_name: partNumberEfectivo });
        }
        const gtinParsed = normalizeGtins(empty_gtin_reason ? '' : (_ovGtin || resolved.codigo_universal || ''));
        if (!empty_gtin_reason && gtinParsed.joined) attributes.push({ id: 'GTIN', value_name: gtinParsed.joined });
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

        // OEM (código original de fábrica) desde atributos_especificos del artículo.
        // Solo se envía si la categoría reconoce el atributo OEM (evita rechazos).
        const oemAttr = resolved.atributos_especificos && typeof resolved.atributos_especificos === 'object'
            ? ((resolved.atributos_especificos as any).OEM || (resolved.atributos_especificos as any).oem || null)
            : null;
        if (oemAttr && (attrInfo?.raw || []).some((a: any) => a.id === 'OEM')) {
            attributes.push({ id: 'OEM', value_name: String(oemAttr) });
        }

        // Herencia fiscal automática (batch/worker sin fiscal_data explícito en request):
        // extrae los 7 FISCAL_ATTR_IDS reales del ítem origen con fallback a articulos.codigo_sat.
        let effectiveFiscalData: any = fiscal_data;
        if (effectiveFiscalData === undefined && (sourceItem || isValidSatKey(resolved.codigo_sat))) {
            const srcFiscal = extractFiscalFromMeliAttributes(sourceItem?.attributes);
            const fallbackSat = isValidSatKey(resolved.codigo_sat) ? String(resolved.codigo_sat).trim() : null;
            const satResolved = srcFiscal.sat_key || fallbackSat;
            if (
                satResolved ||
                srcFiscal.measure_unit_key ||
                srcFiscal.measure_unit_description ||
                srcFiscal.invoice_product_name ||
                srcFiscal.iva_for_resale ||
                srcFiscal.ieps ||
                srcFiscal.import_declaration_number
            ) {
                effectiveFiscalData = {
                    enabled: true,
                    sat_key: satResolved,
                    measure_unit_key: srcFiscal.measure_unit_key,
                    measure_unit_description: srcFiscal.measure_unit_description,
                    invoice_product_name: srcFiscal.invoice_product_name,
                    iva_for_resale: srcFiscal.iva_for_resale,
                    ieps: srcFiscal.ieps,
                    import_declaration_number: srcFiscal.import_declaration_number,
                    save_sat_to_articulo: false,
                };
            }
        }

        // Atributos de la vidriera origen (copia): portar como hints, preservando
        // value_id/value_name. Se filtran atributos de sistema/obsoletos y los ya mapeados.
        if (sourceData?.attributes && Array.isArray(sourceData.attributes)) {
            const mappedIdsPreSource = new Set(attributes.map(a => a.id));
            const hiddenCatAttrIds = new Set(
                (attrInfo.raw || []).filter((a: any) => a?.tags?.hidden).map((a: any) => a.id),
            );
            // SELLER_PACKAGE_* y los atributos hidden/sistema internos de MeLi se omiten aquí:
            // los válidos del vendedor se reconstruyen explícitamente para no filtrar IDs internos (AGID/APGID).
            const SKIP_SOURCE_ATTRS = new Set([
                'EXCLUSIVE_CHANNEL', 'SELLER_CUSTOM_FIELD', 'SIZE_GRID_ID',
                'SELLER_PACKAGE_HEIGHT', 'SELLER_PACKAGE_WIDTH', 'SELLER_PACKAGE_LENGTH', 'SELLER_PACKAGE_WEIGHT',
                'PACKAGE_DATA_SOURCE', 'PACKAGE_HEIGHT', 'PACKAGE_LENGTH', 'PACKAGE_WEIGHT', 'PACKAGE_WIDTH',
                'PRODUCT_FEATURES', 'SHIPMENT_PACKING',
                'AGID', 'APGID', 'PRODUCT_DATA_SOURCE', 'MPN', 'EMPTY_GTIN_REASON', 'IS_KIT', 'CATALOG_TITLE',
            ]);
            for (const sa of sourceData.attributes) {
                if (!sa?.id || SKIP_SOURCE_ATTRS.has(sa.id) || hiddenCatAttrIds.has(sa.id)) continue;
                if (empty_gtin_reason && (sa.id === 'GTIN' || sa.id === 'EAN' || sa.id === 'UPC')) continue;
                if (effectiveFiscalData !== undefined && FISCAL_ATTR_IDS.has(sa.id)) continue;
                if (mappedIdsPreSource.has(sa.id)) continue;
                const out: any = { id: sa.id };
                if (sa.value_id != null) out.value_id = String(sa.value_id);
                if (sa.value_name != null) out.value_name = sa.value_name;
                attributes.push(out);
                mappedIdsPreSource.add(sa.id);
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

        // MeLi exige strings numéricos PUROS (sin "cm"/"g"): altura/ancho/largo en cm, peso en gramos enteros.
        // MeLi exige el formato "número + unidad" para SELLER_PACKAGE_* (cause_id 5402):
        // dimensiones en "cm" enteros y peso en "g" enteros. Ej.: "10 cm", "100 g".
        maybePushPackage('SELLER_PACKAGE_HEIGHT', `${Math.round(resolved.alto_cm  ?? 0)} cm`, !!resolved.alto_cm);
        maybePushPackage('SELLER_PACKAGE_WIDTH',  `${Math.round(resolved.ancho_cm ?? 0)} cm`, !!resolved.ancho_cm);
        maybePushPackage('SELLER_PACKAGE_LENGTH', `${Math.round(resolved.largo_cm ?? 0)} cm`, !!resolved.largo_cm);
        maybePushPackage('SELLER_PACKAGE_WEIGHT', `${Math.round((resolved.peso_kg ?? 0) * 1000)} g`, !!resolved.peso_kg);

        // Formato de venta (Unidad / Pack) y unidades por pack si la categoría los soporta
        const upsertPreAttr = (attrObj: { id: string; value_id?: string; value_name?: string }) => {
            const idx = attributes.findIndex((a) => a.id === attrObj.id);
            if (idx !== -1) attributes[idx] = attrObj;
            else attributes.push(attrObj);
        };
        if (categoryAttrIds.has('SALE_FORMAT')) {
            const targetFormat = effectivePackQty > 1 ? 'Pack' : 'Unidad';
            const saleFormatDef = (attrInfo.raw || []).find((a: any) => a.id === 'SALE_FORMAT');
            const matched = (saleFormatDef?.values || []).find(
                (v: any) => String(v.name || '').trim().toLowerCase() === targetFormat.toLowerCase(),
            );
            upsertPreAttr({
                id: 'SALE_FORMAT',
                ...(matched?.id != null ? { value_id: String(matched.id) } : {}),
                value_name: matched?.name || targetFormat,
            });
        }
        if (categoryAttrIds.has('UNITS_PER_PACK') && effectivePackQty >= 1) {
            upsertPreAttr({
                id: 'UNITS_PER_PACK',
                value_name: String(effectivePackQty),
            });
        }

        // Sin GTIN (EMPTY_GTIN_REASON) / Kit (IS_KIT) validados contra capacidades condicionales de la categoría + marca
        if (empty_gtin_reason && gtinCaps.allows_empty_gtin) {
            const trimmedReason = String(empty_gtin_reason).trim();
            const matchedReason = gtinCaps.empty_reasons.find(
                r => r.id === trimmedReason || r.name.toLowerCase() === trimmedReason.toLowerCase(),
            );
            if (matchedReason) {
                upsertPreAttr({
                    id: 'EMPTY_GTIN_REASON',
                    value_id: matchedReason.id,
                    value_name: matchedReason.name,
                });
            } else if (trimmedReason) {
                upsertPreAttr({
                    id: 'EMPTY_GTIN_REASON',
                    ...(/^\d+$/.test(trimmedReason) ? { value_id: trimmedReason } : {}),
                    value_name: trimmedReason,
                });
            }
        }
        const effectiveIsKit = Boolean(is_kit || empty_gtin_reason === '17055159' || gtinParsed.list.length > 1);
        if (effectiveIsKit && gtinCaps.supports_is_kit) {
            upsertPreAttr({ id: 'IS_KIT', value_id: '242085', value_name: 'Sí' });
        }

        // Datos fiscales SAT / CFDI — explícito del operador o heredado de la vidriera origen (sin inventar defaults)
        const fiscalEnviados: Array<{ id: string; value_name?: string; value_id?: string }> = [];
        const fiscalOmitidos: string[] = [];
        if (effectiveFiscalData && typeof effectiveFiscalData === 'object' && effectiveFiscalData.enabled !== false) {
            const pushFiscal = (id: string, payload: { value_name?: string; value_id?: string }) => {
                if (!categoryAttrIds.has(id)) {
                    fiscalOmitidos.push(`${id} (no soportado por ${category_id})`);
                    return;
                }
                const obj = { id, ...payload };
                upsertPreAttr(obj);
                fiscalEnviados.push(obj);
            };
            const resolveListFiscal = (id: string, rawVal: string, fallbackMap: Record<string, string>) => {
                const trimmed = rawVal.trim();
                const def = (attrInfo.raw || []).find((a: any) => a.id === id);
                const lower = trimmed.toLowerCase();
                const matched = (def?.values || []).find(
                    (v: any) => String(v.name || '').trim().toLowerCase() === lower || String(v.id) === trimmed,
                );
                const fallbackId = fallbackMap[lower];
                const resolvedId = matched?.id != null ? String(matched.id) : fallbackId;
                return resolvedId
                    ? { value_id: resolvedId, value_name: matched?.name || trimmed }
                    : { value_name: trimmed };
            };

            const satKeyVal = effectiveFiscalData.sat_key != null ? String(effectiveFiscalData.sat_key).trim() : '';
            if (satKeyVal) pushFiscal('SAT_KEY', { value_name: satKeyVal });

            const unitKeyVal = effectiveFiscalData.measure_unit_key != null ? String(effectiveFiscalData.measure_unit_key).trim().toUpperCase() : '';
            if (unitKeyVal) pushFiscal('MEASURE_UNIT_KEY', { value_name: unitKeyVal });

            const unitDescVal = effectiveFiscalData.measure_unit_description != null ? String(effectiveFiscalData.measure_unit_description).trim() : '';
            if (unitDescVal) pushFiscal('MEASURE_UNIT_DESCRIPTION', { value_name: unitDescVal });

            const invoiceNameVal = effectiveFiscalData.invoice_product_name != null ? String(effectiveFiscalData.invoice_product_name).trim().slice(0, 255) : '';
            if (invoiceNameVal) pushFiscal('INVOICE_PRODUCT_NAME', { value_name: invoiceNameVal });

            const ivaVal = effectiveFiscalData.iva_for_resale != null ? String(effectiveFiscalData.iva_for_resale).trim() : '';
            if (ivaVal) pushFiscal('IVA_FOR_RESALE', resolveListFiscal('IVA_FOR_RESALE', ivaVal, IVA_VALUE_IDS));

            const iepsVal = effectiveFiscalData.ieps != null ? String(effectiveFiscalData.ieps).trim() : '';
            if (iepsVal) pushFiscal('IEPS', resolveListFiscal('IEPS', iepsVal, IEPS_VALUE_IDS));

            const pedimentoRaw = effectiveFiscalData.import_declaration_number != null ? String(effectiveFiscalData.import_declaration_number).replace(/\D/g, '') : '';
            if (pedimentoRaw.length > 0) pushFiscal('IMPORT_DECLARATION_NUMBER', { value_name: pedimentoRaw.slice(0, 18) });
        }
        trace.paso_7_fiscal = {
            enabled: !!(effectiveFiscalData && typeof effectiveFiscalData === 'object' && effectiveFiscalData.enabled !== false),
            auto_heredado: fiscal_data === undefined && Boolean(effectiveFiscalData),
            enviados: fiscalEnviados,
            omitidos: fiscalOmitidos,
            articulo_codigo_sat: resolved.codigo_sat ?? null,
            source_fiscal: sourceItem ? extractFiscalFromMeliAttributes(sourceItem.attributes) : null,
        };

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
        const hasEmptyReasonAttr = mappedIds.has('EMPTY_GTIN_REASON');
        const unresolvedAttrs = effectiveRequiredAttrs
            .filter((a: any) => !mappedIds.has(a.id) && !(hasEmptyReasonAttr && gtinCaps.allows_empty_gtin && a.id === 'GTIN'))
            .map((a: any) => ({
                id:         a.id,
                name:       a.name,
                value_type: a.value_type || 'list',
                values:     (a.values || []).slice(0, 30).map((v: any) => ({ id: String(v.id), name: v.name })),
            }));
        trace.paso_7_atributos_faltantes = unresolvedAttrs.map((a: any) => ({ id: a.id, name: a.name }));

        // -- 8. GPT-4o-mini: 3 candidatos "Título ML 60" + resolver atributos + descripción --
        const aiResult = await resolvePublicationAI({
            nombre:                 resolved.nombre || '',
            marca:                  resolved.marca  || '',
            modelo:                 resolved.modelo || '',
            variante:               resolved.variante || null,
            categoria:              category_path || category_id || resolved.categoria || null,
            materiales:             resolved.materiales || null,
            peso_kg:                resolved.peso_kg ?? null,
            largo_cm:               resolved.largo_cm ?? null,
            ancho_cm:               resolved.ancho_cm ?? null,
            alto_cm:                resolved.alto_cm ?? null,
            pais_origen:            resolved.pais_origen || null,
            unidades_pack:          effectivePackQty,
            bullet_points:          resolved.bullet_points || [],
            resolved_attributes:    attributes.filter(a => a.value_name).map(a => ({ id: a.id, value_name: a.value_name })),
            descripcion:            resolved.descripcion,
            atributos_especificos:  resolved.atributos_especificos,
            unresolved_attributes:  unresolvedAttrs,
            max_family_name_chars:  60,
            legacy:                 isLegacy,
            rephrase_description:   true, // genera la descripción con IA también en publicaciones nuevas
        }, { marketplace_id, categoria: category_id });
        // Respetar el máximo de 60 caracteres del perfil "Título ML 60"
        if (aiResult.family_name) {
            aiResult.family_name = truncarTitulo(limpiarTitulo(aiResult.family_name), 60);
        }

        // Construir mapa de valores permitidos por atributo para validación posterior
        const allowedValuesByAttr: Map<string, Set<string>> = new Map();
        for (const attr of effectiveRequiredAttrs) {
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
            profiles:         aiResult.profiles ?? null,
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
            for (const rawOv of attribute_overrides) {
                if (empty_gtin_reason && (rawOv.id === 'GTIN' || rawOv.id === 'EAN' || rawOv.id === 'UPC')) continue;
                let ov = rawOv;
                if (ov.id === 'GTIN' && ov.value_name) {
                    const normalized = normalizeGtins(ov.value_name).joined;
                    if (normalized) ov = { ...ov, value_name: normalized };
                }
                const idx = allAttributes.findIndex((a: any) => a.id === ov.id);
                if (idx !== -1) {
                    allAttributes[idx] = { ...allAttributes[idx], ...ov };
                } else {
                    allAttributes.push(ov);
                }
            }
            trace.paso_8_overrides_usuario = attribute_overrides;
        }

        // Descartar atributos que MeLi marca estrictamente como read_only en la categoría (ej. PACKS_NUMBER, VALUE_ADDED_TAX, PACKAGE_HEIGHT).
        // NUNCA descartar los atributos hidden que son editables por el vendedor (SELLER_PACKAGE_*, SELLER_SKU, ITEM_CONDITION),
        // pues sin SELLER_PACKAGE_* MeLi no puede calcular Mercado Envíos (me2) y rechaza con 'shipping.lost_me1_by_user'.
        const readOnlyAttrIds = new Set(
            (attrInfo.raw || [])
                .filter((a: any) => a.tags?.read_only)
                .map((a: any) => a.id)
        );
        const cleanAttributes = allAttributes.filter(
            (a: any) => !readOnlyAttrIds.has(a.id) && (a.value_name != null && a.value_name !== '' || a.value_id != null)
        );
        trace.paso_8_attributes_final = cleanAttributes;

        // Atributos requeridos todavía faltantes después del AI
        const stillMissingIds = new Set(allAttributes.map((a: any) => a.id));
        const stillMissing = effectiveRequiredAttrs
            .filter((a: any) => !stillMissingIds.has(a.id) && !(hasEmptyReasonAttr && gtinCaps.allows_empty_gtin && a.id === 'GTIN'))
            .map((a: any) => ({ id: a.id, name: a.name }));
        trace.paso_8_atributos_aun_faltantes = stillMissing;

        // -- 9. Construir el body del POST /items (UP o legacy) -----------------
        // Imágenes efectivas: si no se enviaron, se heredan de la vidriera origen.
        const effectivePictures: string[] = pictures.length > 0
            ? pictures
            : (sourceData?.pictures?.length ? sourceData.pictures : []);

        // IDs MeLi ya existentes, alineados con effectivePictures. Solo aplican
        // cuando heredamos de la vidriera origen (Flujo 1); las URLs externas del
        // request nunca traen id, así que se re-suben.
        // Reutilizar IDs MeLi de la vidriera origen cuando la URL coincide: evita
        // re-subir y re-validar el tamaño (causa del "invalid_size" al copiar).
        // Normalizar el sufijo de tamaño de MeLi (-I, -V, -M, -C, -O, -F) para que
        // las URLs heredadas coincidan aunque el frontend las muestre en alta (-F).
        const normalizeMeliUrl = (u: string) => (typeof u === 'string'
            ? u.replace(/^http:/i, 'https:').replace(/\/D_NQ_NP_(?=\d)/i, '/D_').replace(/-[IVMCOF]\.(jpg|jpeg|png|webp)$/i, '')
            : u);
        const sourceIdByUrl = new Map<string, string>();
        (sourceData?.pictures || []).forEach((u: string, i: number) => {
            const id = sourceData?.picture_ids?.[i];
            if (id && u) sourceIdByUrl.set(normalizeMeliUrl(u), String(id));
        });
        const inheritedIds: (string | null)[] = effectivePictures.map((u) => sourceIdByUrl.get(normalizeMeliUrl(u)) || null);

        // -- Pre-subir SOLO las imágenes sin id MeLi (publish real) --------------
        // Flujo 1: las fotos que ya viven en MeLi se referencian por su {id} sin
        // re-descargar ni re-subir. Las URLs externas (o sin id) se suben para
        // obtener un picture_id y crear con {id} en vez de {source: url}, evitando
        // 'picture_download_pending'. Si todo falla, cae al source URL (comportamiento
        // anterior) y el diagnóstico informa.
        let picturesField: Array<{ id: string } | { source: string }>;
        if (!dry_run && effectivePictures.length > 0) {
            const field: Array<{ id: string } | { source: string }> = [];
            const urlsPorSubir: Array<{ index: number; url: string }> = [];

            effectivePictures.forEach((url, i) => {
                const id = inheritedIds[i];
                if (id) {
                    field[i] = { id }; // ya MeLi → reutilizar, sin re-subir
                } else {
                    urlsPorSubir.push({ index: i, url });
                }
            });

            const urlsParaSubir = await Promise.all(
                urlsPorSubir.map(async (x) => ({ index: x.index, url: await ensureImageSize(x.url) })),
            );
            const subidas: string[] = await (meli as any).uploadPicturesFromUrls(
                marketplace_id,
                urlsParaSubir.map((x) => x.url),
            );
            urlsParaSubir.forEach((x, k) => {
                field[x.index] = subidas[k] ? { id: subidas[k] } : { source: x.url };
            });

            picturesField = field;
            trace.paso_9_preupload_pictures = {
                reutilizadas: inheritedIds.filter(Boolean).length,
                subidas: subidas.length,
                total: effectivePictures.length,
            };
        } else {
            picturesField = effectivePictures.map((url: string) => ({ source: url }));
        }

        // Ficha del catálogo (una sola lectura): sirve para el filtro dinámico de
        // atributos y para exponer el título del catálogo como candidato.
        let catalogoFicha: any = null;
        if (effectiveCatalogListing && effectiveCatalogProductId) {
            catalogoFicha = await (meli as any).getCatalogProduct(marketplace_id, effectiveCatalogProductId);
            trace.paso_9_catalogo_ficha = {
                tiene_ficha: !!catalogoFicha,
                nombre: catalogoFicha?.name ?? null,
                atributos_definidos: (catalogoFicha?.attributes || []).length,
            };
        }

        // Construir descripción sin duplicar bullets cuando la IA ya generó sus viñetas
        const baseDesc = aiResult.description || resolved.descripcion || '';
        const shouldAppendBullets = !aiResult.description && resolved.bullet_points.length > 0;
        const bulletsText = shouldAppendBullets
            ? '\n\n' + resolved.bullet_points.map((b: string) => `• ${b}`).join('\n')
            : '';
        const descripcionCompleta = (
            description_override && description_override.trim()
                ? description_override
                : (baseDesc + bulletsText)
        ).slice(0, 50000);

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

        // Candidatos de título para la tradicional (el panel elige; la de catálogo usa el suyo).
        const tituloCatalogo = catalogoFicha?.name || null;
        const tituloMiCatalogo = isLegacy
            ? [resolved.marca, resolved.modelo, resolved.nombre].filter(Boolean).join(' ')
            : resolved.nombre;
        const tituloIA = isLegacy ? (aiResult.title || null) : (aiResult.family_name || null);

        // Garantía: heredar de la vidriera origen si existe, si no el default.
        const srcWarrantyType = sourceData?.sale_terms?.find((s: any) => s.id === 'WARRANTY_TYPE')?.value_name;
        const srcWarrantyTime = sourceData?.sale_terms?.find((s: any) => s.id === 'WARRANTY_TIME')?.value_name;

        // -- 9. Construir el body del POST /items (UP o legacy) -----------------
        // La publicación TRADICIONAL (base) se crea SIEMPRE: título, fotos, atributos, envío, garantía.
        // El vínculo a catálogo NO se inyecta aquí: se hace después con el optin
        // (POST /items/catalog_listings) para que MeLi las relacione nativamente.
        const tradicionalBody: any = {
            category_id,
            price,
            currency_id: precio_data?.currency || sourceData?.currency || 'MXN',
            available_quantity: Math.max(stock, 1),
            buying_mode: 'buy_it_now',
            listing_type_id,
            shipping: {
                mode: shipping_mode || 'me2',
                free_shipping: !!free_shipping,
                ...(sourceData?.shipping?.dimensions ? { dimensions: sourceData.shipping.dimensions } : {}),
            },
            // legacy exige condition; UP lo deriva del catálogo
            ...(isLegacy ? { condition: 'new' } : {}),
            sale_terms: [
                { id: 'WARRANTY_TYPE', value_name: srcWarrantyType || 'Garantía del vendedor' },
                { id: 'WARRANTY_TIME', value_name: srcWarrantyTime || '1 mes' },
                // MANUFACTURING_TIME solo si hay días de elaboración (1-60). 0 = omitir.
                ...(manufacturing_time_days != null
                    && Number(manufacturing_time_days) >= 1
                    && Number(manufacturing_time_days) <= 60
                    ? [{ id: 'MANUFACTURING_TIME', value_name: `${Number(manufacturing_time_days)} días` }]
                    : []),
            ],
            pictures: picturesField,
            attributes: cleanAttributes,
            // legacy: MeLi exige title; UP: family_name.
            ...(isLegacy ? { title: titleLegacy } : { family_name: familyNameFinal }),
        };

        trace.paso_9_titulo = {
            modelo_seller: isLegacy ? 'legacy' : 'up',
            title_legacy: isLegacy ? titleLegacy : null,
            family_name_up: isLegacy ? null : familyNameFinal,
            fuente: family_name_override ? 'override_manual' : aiResult.ai_used ? 'gpt_4o_mini' : 'compuesto',
            candidatos: {
                catalogo: tituloCatalogo,
                mi_catalogo: tituloMiCatalogo,
                ia: tituloIA,
                ia_alternativas: aiResult.title_candidates || [],
            },
            price_source: priceSource,
            price_final: price,
        };
        trace.paso_9_descripcion = {
            chars: descripcionCompleta.length,
            bullets: shouldAppendBullets ? resolved.bullet_points.length : 0,
            preview_text: descripcionCompleta,
        };

        trace.paso_9_body = tradicionalBody;

        // -- 10. Validaciones DURAS — errores 422 bloqueantes -----------------
        const erroresDuros: string[] = [];
        if (effectivePictures.length === 0 && !dry_run) erroresDuros.push('Sin imágenes: MeLi rechaza publicaciones sin pictures[]');
        // Precio: en dry_run se permite 0 (el operador lo fijará manual); en publish real bloquea.
        if (price === 0 && !dry_run) erroresDuros.push('Precio = 0: fija un precio manual antes de publicar (el artículo no tiene costo ni regla de precio)');
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

        // Identificación efectiva (overrides > datos resueltos)
        const effectiveMarca  = (_ovMarca  || resolved.marca  || '').trim();
        const effectiveModelo = (_ovModelo || resolved.modelo || '').trim();
        const effectiveGtin   = empty_gtin_reason ? '' : (gtinParsed.joined || '');

        // Validación en vivo de GTIN / EMPTY_GTIN_REASON contra capacidades condicionales de la categoría + marca
        const gtinWarnings: string[] = [];
        if (empty_gtin_reason && !gtinCaps.allows_empty_gtin) {
            const msg = gtinCaps.gtin_required_for_brand
                ? `MeLi exige GTIN obligatorio para la marca "${brandForCond || effectiveMarca || 'seleccionada'}" en ${category_id} aun marcando kit / Sin GTIN. Usa modo "Con GTIN"${gtinCaps.multivalued ? ' (acepta varios GTIN separados por coma)' : ''}.`
                : `La categoría ${category_id} no acepta publicación sin GTIN (EMPTY_GTIN_REASON) en MeLi. Captura 1 o varios GTIN separados por coma.`;
            gtinWarnings.push(msg);
            if (!dry_run) erroresDuros.push(msg);
        }
        if (!empty_gtin_reason && gtinParsed.invalid.length > 0) {
            const msg = `GTIN inválido (debe tener entre 8 y 14 dígitos): ${gtinParsed.invalid.join(', ')}`;
            gtinWarnings.push(msg);
            if (!dry_run) erroresDuros.push(msg);
        }
        if (!empty_gtin_reason && gtinParsed.list.length > 1 && !gtinCaps.multivalued) {
            const msg = `La categoría ${category_id} solo acepta 1 GTIN (no soporta múltiples GTINs separados por coma). Usa 1 solo GTIN o elige "Sin GTIN / Es un kit".`;
            gtinWarnings.push(msg);
            if (!dry_run) erroresDuros.push(msg);
        }
        if (gtinWarnings.length > 0) {
            trace.paso_6_gtin_advertencia = gtinWarnings.join(' ');
        }

        // Validación estricta Opción B + pre-check de duplicados en Catálogo Maestro
        let existingCatalogMatch: { articulo_id: string; nombre: string; publicacion_ml?: string | null; codigo_sat?: string | null } | null = null;
        if (register_in_catalog && !resolvedArticuloId) {
            if (resolved.nombre.trim().length < 5) {
                erroresDuros.push('Para dar de alta en Catálogo Maestro el nombre debe tener al menos 5 caracteres');
            }
            if (!effectiveMarca) {
                erroresDuros.push('Para dar de alta en Catálogo Maestro la Marca es obligatoria');
            }
            if (!effectiveModelo) {
                erroresDuros.push('Para dar de alta en Catálogo Maestro el Modelo es obligatorio');
            }
            if (effectiveMarca && effectiveModelo) {
                if (effectiveGtin) {
                    const { data: gtinMatch } = await supabaseAdmin
                        .from('articulos')
                        .select('articulo_id, nombre, publicacion_ml, codigo_sat')
                        .eq('codigo_universal', effectiveGtin)
                        .limit(1)
                        .maybeSingle();
                    if (gtinMatch) existingCatalogMatch = gtinMatch;
                }
                if (!existingCatalogMatch) {
                    const { data: mmMatch } = await supabaseAdmin
                        .from('articulos')
                        .select('articulo_id, nombre, publicacion_ml, codigo_sat')
                        .ilike('marca', effectiveMarca)
                        .ilike('modelo', effectiveModelo)
                        .limit(1)
                        .maybeSingle();
                    if (mmMatch) existingCatalogMatch = mmMatch;
                }
                trace.paso_0_5_catalogo = existingCatalogMatch
                    ? { accion: 'vinculara_existente', articulo_id: existingCatalogMatch.articulo_id, nombre: existingCatalogMatch.nombre }
                    : { accion: 'creara_nuevo_web', nombre: resolved.nombre };
            }
        }

        // Respaldo de compatibilidades automotrices desde el ítem/UP origen en MeLi cuando no existen localmente
        const hasCompatInInput = !!(compatibilities && ((compatibilities.products || []).length > 0 || (compatibilities.products_families || []).length > 0));
        const hasCompatInArt = Array.isArray(resolved.atributos_especificos?.compatibilidades) && resolved.atributos_especificos.compatibilidades.length > 0;
        let inheritedSourceCompat: any = null;
        if (
            !hasCompatInInput &&
            !hasCompatInArt &&
            source_marketplace_id &&
            source_item_id &&
            (isAutomotiveCategory || (sourceItem?.tags || []).some((t: string) => String(t).includes('compatibilities')))
        ) {
            try {
                inheritedSourceCompat = await (meli as any).getCompatibilities(
                    source_marketplace_id,
                    source_item_id,
                    sourceItem?.user_product_id ?? null,
                );
                if (inheritedSourceCompat) {
                    trace.paso_12_5_compatibilidades_origen = {
                        ok: true,
                        familias: inheritedSourceCompat.products_families?.length ?? 0,
                        productos: inheritedSourceCompat.products?.length ?? 0,
                    };
                }
            } catch { /* best-effort */ }
        }
        const hasCompatResolved = hasCompatInInput || hasCompatInArt || Boolean(inheritedSourceCompat);
        if (isAutomotiveCategory && !hasCompatResolved) {
            trace.paso_12_5_advertencia = 'Categoría automotriz sin compatibilidades vehiculares: Mercado Libre podría dejar la publicación en revisión (under_review / waiting_for_patch) hasta agregar vehículos compatibles.';
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
                advertencia_duplicado: firstDupMatch ? { item_existente: firstDupMatch.external_item_id, status: firstDupMatch.status_externo } : null,
                duracion_ms: Date.now() - startTime,
                trace,
            });
        }

        // -- 11.5 Pre-vuelo: POST /items/validate (diagnóstico NO bloqueante) ----
        // No debe impedir la publicación: /items/validate emite falsos positivos
        // (ej. shipping.lost_me1_by_user en cuentas me2) que POST /items no aplica.
        // createItem (POST /items) valida de nuevo y devuelve los errores reales.
        try {
            const validacion = await (meli as any).validateItem(marketplace_id, tradicionalBody);
            trace.paso_11_5_validate = validacion;
            if (!validacion.ok) {
                trace.paso_11_5_advertencia = validacion.errores;
                console.warn('[publish/validateItem] advertencia no bloqueante:', JSON.stringify(validacion.errores));
            }
        } catch (e: any) {
            trace.paso_11_5_error = e?.message || 'validateItem falló (ignorado)';
        }

        // -- 12. Publicar en MeLi: primero la TRADICIONAL (base) ----------------
        const created = await (meli as any).createItem(marketplace_id, tradicionalBody);
        trace.paso_12_meli_create = {
            item_id:         created.item_id,
            user_product_id: created.user_product_id,
            family_id:       created.family_id,
            permalink:       created.permalink,
            title_generado:  created.title,
            status:          created.status,
        };
        trace.paso_12_meli_raw = created.raw; // respuesta completa de MeLi para inspección

        // -- 12bis. Esperar a que MeLi descargue las imágenes ---------------------
        // MeLi crea la publicación 'paused' con sub_status 'picture_download_pending'
        // mientras baja las fotos. El optin exige 'active', así que sondeamos hasta
        // que quede activa (máx ~20s) antes de optar al catálogo.
        if (
            effectiveCatalogListing && effectiveCatalogProductId &&
            created.status === 'paused' &&
            Array.isArray(created.raw?.sub_status) && created.raw.sub_status.includes('picture_download_pending')
        ) {
            const esperaInicio = Date.now();
            const maxEsperaMs = 20000;
            const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
            let intentos = 0;
            let esperaError: string | null = null;
            while (Date.now() - esperaInicio < maxEsperaMs && created.status === 'paused') {
                await sleep(2000);
                intentos++;
                try {
                    const refrescado = await (meli as any).getItem(marketplace_id, created.item_id);
                    if (refrescado) {
                        created.status = refrescado.status || created.status;
                        trace.paso_12_meli_raw = refrescado; // estado más reciente para diagnóstico
                    }
                } catch (e: any) {
                    esperaError = e.message;
                    break;
                }
            }
            trace.paso_12_espera_imagenes = {
                status_inicial: 'paused',
                status_final: created.status,
                ms: Date.now() - esperaInicio,
                intentos,
                ...(esperaError ? { error: esperaError } : {}),
            };
        }

        // -- 12b. Optin a CATÁLOGO vinculado (si aplica) ------------------------
        // Usa POST /items/catalog_listings con el item_id de la tradicional recién
        // creada + catalog_product_id. MeLi las relaciona nativamente (item_relations).
        let createdCatalog: any = null;
        let catalogOptinPendiente = false;
        if (effectiveCatalogListing && effectiveCatalogProductId) {
            try {
                createdCatalog = await (meli as any).optinCatalogListing(marketplace_id, {
                    item_id: created.item_id,
                    catalog_product_id: effectiveCatalogProductId,
                });
                trace.paso_12b_catalogo = {
                    item_id:        createdCatalog.item_id,
                    permalink:      createdCatalog.permalink,
                    title:          createdCatalog.title,
                    status:         createdCatalog.status,
                    item_relations: createdCatalog.item_relations,
                };
            } catch (optinErr: any) {
                // Fail-safe: la tradicional ya existe en MeLi. Si el optin falla
                // (típicamente "Item must be active to optin" por picture_download_pending),
                // NO crasheamos: persistimos la tradicional y encolamos un reintento.
                catalogOptinPendiente = true;
                trace.paso_12b_catalogo = {
                    error: optinErr?.message || String(optinErr),
                    diferido: true,
                    motivo: 'optin_catalog_fallido',
                };
            }
        } else {
            trace.paso_12b_catalogo = { omitido: 'Sin catálogo' };
        }

        // -- 12.5 Compatibilidades vehiculares (autopartes): opcional, no bloqueante --
        let effectiveCompatibilities = compatibilities || inheritedSourceCompat;
        if (!effectiveCompatibilities || ((effectiveCompatibilities.products || []).length === 0 && (effectiveCompatibilities.products_families || []).length === 0)) {
            const aplicaciones = resolved.atributos_especificos && typeof resolved.atributos_especificos === 'object'
                ? (resolved.atributos_especificos as any).compatibilidades
                : null;
            if (Array.isArray(aplicaciones) && aplicaciones.length > 0) {
                try {
                    effectiveCompatibilities = await (meli as any).resolveCompatibilityFamilies(marketplace_id, aplicaciones);
                } catch (e) {
                    effectiveCompatibilities = buildCompatibilitiesFromAplicaciones(aplicaciones);
                }
            } else {
                effectiveCompatibilities = null;
            }
        }
        if (effectiveCompatibilities && ((effectiveCompatibilities.products || []).length > 0 || (effectiveCompatibilities.products_families || []).length > 0)) {
            try {
                const compRes = await (meli as any).addCompatibilities(marketplace_id, created.item_id, effectiveCompatibilities, created.user_product_id, category_id);
                const enviadas = (effectiveCompatibilities.products?.length ?? 0) + (effectiveCompatibilities.products_families?.length ?? 0);
                trace.paso_12_5_compatibilidades = { ok: true, enviadas, created_compatibilities_count: compRes?.created_compatibilities_count ?? null };
            } catch (compErr: any) {
                trace.paso_12_5_compatibilidades = { error: compErr.message || String(compErr) };
            }
        } else {
            trace.paso_12_5_compatibilidades = { omitido: 'Sin compatibilidades en el request ni en el artículo' };
        }

        // -- 13. Descripción: va a la TRADICIONAL (la de catálogo la aporta MeLi) --
        let descResult: any = null;
        if (descripcionCompleta) {
            try {
                descResult = await (meli as any).addDescription(marketplace_id, created.item_id, descripcionCompleta);
                trace.paso_13_descripcion = { ok: descResult?.ok ?? true, chars: descripcionCompleta.length };
            } catch (descErr: any) {
                trace.paso_13_descripcion = { ok: false, error: descErr?.message || String(descErr), chars: descripcionCompleta.length };
            }
        } else {
            trace.paso_13_descripcion = { omitido: 'Sin descripción disponible (ni en ficha ni en artículo)' };
        }

        // -- 13.2 Pausar / ajustar stock a 0 tras crear (POST /items exige >=1) --
        let persistedStock = Math.max(stock, 1);
        if (wantsPaused && !catalogOptinPendiente) {
            let pauseError: string | null = null;
            if (wantsZeroStock) {
                try {
                    const stRes = await (meli as any).updateStock(marketplace_id, [{ itemId: created.item_id, quantity: 0 }]);
                    if (stRes?.[0]?.status === 'success') {
                        persistedStock = 0;
                        if (stRes[0]?.data?.status === 'paused') created.status = 'paused';
                    } else if (stRes?.[0]?.error) {
                        pauseError = typeof stRes[0].error === 'string' ? stRes[0].error : JSON.stringify(stRes[0].error);
                    }
                } catch (e: any) {
                    pauseError = e?.message || String(e);
                }
            }
            if (created.status !== 'paused') {
                try {
                    await (meli as any).pauseListing(marketplace_id, created.item_id);
                    created.status = 'paused';
                } catch (e: any) {
                    pauseError = pauseError ? `${pauseError}; ${e?.message || String(e)}` : (e?.message || String(e));
                }
            }
            if (createdCatalog?.item_id) {
                try {
                    await (meli as any).pauseListing(marketplace_id, createdCatalog.item_id);
                    createdCatalog.status = 'paused';
                } catch (e: any) {
                    pauseError = pauseError ? `${pauseError}; cat: ${e?.message || String(e)}` : `cat: ${e?.message || String(e)}`;
                }
            }
            trace.paso_13_2_pausa = {
                aplicada: created.status === 'paused',
                stock_final: persistedStock,
                catalogo_pausado: createdCatalog ? createdCatalog.status === 'paused' : null,
                error: pauseError,
            };
        } else if (wantsPaused && catalogOptinPendiente) {
            trace.paso_13_2_pausa = {
                diferida_post_optin: true,
                stock_cero: wantsZeroStock,
            };
        }

        // -- 13.5 Alta explícita en Catálogo Maestro (Opción B vía web_upsert_articulo) --
        let createdNewCatalogArticle = false;
        if (register_in_catalog && !resolvedArticuloId) {
            if (existingCatalogMatch?.articulo_id) {
                resolvedArticuloId = existingCatalogMatch.articulo_id;
                articulo = { ...articulo, ...existingCatalogMatch };
                trace.paso_0_5_catalogo = { accion: 'vinculado_existente', articulo_id: resolvedArticuloId };
            } else {
                const numFromAttr = (id: string) => {
                    const v = cleanAttributes.find((a: any) => a.id === id)?.value_name;
                    const m = v != null ? String(v).match(/\d+(\.\d+)?/) : null;
                    return m ? Number(m[0]) : null;
                };
                const effPesoG = numFromAttr('SELLER_PACKAGE_WEIGHT');
                const effPesoKg = resolved.peso_kg != null ? Number(resolved.peso_kg) : (effPesoG != null ? effPesoG / 1000 : null);
                const effLargoCm = numFromAttr('SELLER_PACKAGE_LENGTH') ?? (resolved.largo_cm != null ? Number(resolved.largo_cm) : null);
                const effAnchoCm = numFromAttr('SELLER_PACKAGE_WIDTH') ?? (resolved.ancho_cm != null ? Number(resolved.ancho_cm) : null);
                const effAltoCm = numFromAttr('SELLER_PACKAGE_HEIGHT') ?? (resolved.alto_cm != null ? Number(resolved.alto_cm) : null);

                let newArtId: string | null = null;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const candidate = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
                    const { data: dup } = await supabaseAdmin
                        .from('articulos')
                        .select('articulo_id')
                        .eq('articulo_id', candidate)
                        .maybeSingle();
                    if (!dup) { newArtId = candidate; break; }
                }

                if (newArtId) {
                    const satForNewArt = (effectiveFiscalData?.enabled !== false && effectiveFiscalData?.sat_key && /^\d{8}$/.test(String(effectiveFiscalData.sat_key).trim()))
                        ? String(effectiveFiscalData.sat_key).trim()
                        : null;
                    const { error: upsertArtErr } = await supabaseAdmin.rpc('web_upsert_articulo', {
                        p_articulo_id: newArtId,
                        p_nombre: resolved.nombre.slice(0, 200),
                        p_marca: effectiveMarca,
                        p_modelo: effectiveModelo,
                        p_variante: resolved.variante || null,
                        p_categoria: category_id || resolved.categoria || null,
                        p_caja_madre: null,
                        p_codigo_universal: empty_gtin_reason ? null : (gtinParsed.list[0] || null),
                        p_codigo_sat: satForNewArt,
                        p_url_producto: null,
                        p_notas: null,
                        p_peso_kg: effPesoKg,
                        p_es_full: false,
                        p_es_dropshipping: false,
                        p_descripcion: descripcionCompleta || null,
                        p_largo_cm: effLargoCm,
                        p_ancho_cm: effAnchoCm,
                        p_alto_cm: effAltoCm,
                        p_imagenes: effectivePictures.length > 0 ? effectivePictures : null,
                    });
                    if (!upsertArtErr) {
                        resolvedArticuloId = newArtId;
                        createdNewCatalogArticle = true;
                        trace.paso_0_5_catalogo = { accion: 'creado_web', articulo_id: newArtId };
                    } else {
                        trace.paso_0_5_catalogo = { error: upsertArtErr.message };
                    }
                } else {
                    trace.paso_0_5_catalogo = { error: 'No se pudo generar un articulo_id único de 8 chars' };
                }
            }
        }

        // -- 14-15. Persistir AMBAS publicaciones (tradicional + catálogo) ------
        const pubsToPersist: Array<{
            item: any;
            tipo: string;
            es_fuente_stock: boolean;
            id_padre: string | null;
            id_catalogo: string | null;
            par_item_id: string | null;
        }> = [
            {
                item: created,
                tipo: 'tradicional',
                es_fuente_stock: true,
                id_padre: null,
                // La tradicional ya NO referencia catalog_product_id (el vínculo lo
                // crea el optin). El sync rellenará este campo si MeLi lo asigna.
                id_catalogo: null,
                par_item_id: createdCatalog ? createdCatalog.item_id : null,
            },
        ];
        if (createdCatalog) {
            pubsToPersist.push({
                item: createdCatalog,
                tipo: 'catalogo',
                es_fuente_stock: false,
                id_padre: created.item_id,
                id_catalogo: effectiveCatalogProductId,
                par_item_id: created.item_id,
            });
        }

        const persistedIds: string[] = [];
        const persistErrors: string[] = [];
        for (const p of pubsToPersist) {
            const { data: pubInserted, error: pubErr } = await supabaseAdmin
                .from('publicaciones_externas')
                .upsert({
                    marketplace_id,
                    external_item_id:      p.item.item_id,
                    user_product_id:       p.item.user_product_id ?? null,
                    external_variation_id: '0',
                    titulo:                p.item.title,
                    precio_venta:          price,
                    stock_publicado:       persistedStock,
                    status_externo:        p.item.status,
                    permalink:             p.item.permalink,
                    listing_type_id,
                    category_id,
                    tipo_publicacion:      p.tipo,
                    id_publicacion_padre:  p.id_padre,
                    id_producto_catalogo:  p.id_catalogo,
                    par_item_id:           p.par_item_id,
                    es_fuente_stock:       p.es_fuente_stock,
                    free_shipping:         !!free_shipping,
                    shipping_mode:         shipping_mode,
                    seller_sku:            sku_efectivo || null,
                    esta_mapeado:          Boolean(resolvedArticuloId),
                    gtin:                  effectiveGtin || null,
                    brand:                 effectiveMarca || null,
                    model:                 effectiveModelo || null,
                    domain_id:             catDomainId || null,
                    condition:             'new',
                    actualizado_el:        new Date().toISOString(),
                }, { onConflict: 'marketplace_id,external_item_id,external_variation_id' })
                .select('id')
                .single();

            if (pubInserted?.id) {
                persistedIds.push(pubInserted.id);
                if (resolvedArticuloId) {
                    const isFulfillment = (sourceData?.shipping?.logistic_type === 'fulfillment') || (sourceItem?.shipping?.logistic_type === 'fulfillment');
                    const { error: mapErr } = await supabaseAdmin
                        .from('mapeo_publicacion_articulo')
                        .upsert({
                            publicacion_id:     pubInserted.id,
                            articulo_id:        resolvedArticuloId,
                            cantidad_requerida: effectivePackQty,
                            sincronizar_stock:  !isFulfillment && !createdNewCatalogArticle,
                        }, { onConflict: 'publicacion_id,articulo_id' });
                    if (mapErr) persistErrors.push(`mapeo ${p.item.item_id}: ${mapErr.message}`);
                }
            } else if (pubErr) {
                persistErrors.push(`upsert ${p.item.item_id}: ${pubErr.message}`);
            }
        }

        // -- 14c. Optin de catálogo diferido (fail-safe) ------------------------
        // Si el optin falló (tradicional en paused por picture_download_pending),
        // la tradicional YA está persistida y mapeada. Encolamos un reintento con
        // backoff progresivo (lo procesa el worker) para cuando MeLi active las fotos.
        if (catalogOptinPendiente && effectiveCatalogListing && effectiveCatalogProductId && persistedIds[0]) {
            await supabaseAdmin.from('jobs').insert({
                type: 'catalog_optin',
                payload: {
                    publicacion_id:     persistedIds[0],
                    item_id:            created.item_id,
                    marketplace_id,
                    catalog_product_id: effectiveCatalogProductId,
                    intento:            0,
                    ...(wantsPaused ? { pause_after_optin: true, zero_stock_after_optin: wantsZeroStock } : {}),
                },
                status: 'pending',
                max_attempts: 5,
                scheduled_at: new Date(Date.now() + 60_000).toISOString(),
            });
            trace.paso_14c_optin_diferido = { encolado: true, item_id: created.item_id };
        }

        trace.paso_14_publicaciones = {
            tradicional: created.item_id,
            catalogo:    createdCatalog?.item_id ?? null,
            persistidas: persistedIds.length,
            errores:     persistErrors,
        };

        // -- 14a. Registro de auditoría: la publicación recién creada nace "auditada".
        // (Es recién publicada: no requiere revisión inmediata. Fail-safe, no bloquea la respuesta.)
        const auditAction = sourceData
            ? 'creada_desde_copia'
            : (!articulo_id && !createdNewCatalogArticle ? 'creada_desde_cero' : 'creada_nueva');
        for (const pid of persistedIds) {
            await registrarAuditoria(pid, 'publicacion', auditAction, { item_id: created.item_id });
        }

        // -- 14b. Vincular tradicional ↔ catálogo de inmediato -----------------
        // El RPC recalcular_par_item_id solo empareja tipo 'tradicional' (NO 'up'),
        // y el sync reclasifica 'up'→'tradicional' recién en el próximo sync. Por eso
        // fijamos par_item_id directamente (funciona para 'up' y 'tradicional') y
        // luego corremos los RPC de conteo (indiferentes al tipo).
        try {
            const newItemIds = [created.item_id, ...(createdCatalog ? [createdCatalog.item_id] : [])];
            if (createdCatalog) {
                await supabaseAdmin.from('publicaciones_externas')
                    .update({ par_item_id: createdCatalog.item_id })
                    .eq('marketplace_id', marketplace_id)
                    .eq('external_item_id', created.item_id)
                    .eq('external_variation_id', '0');
                await supabaseAdmin.from('publicaciones_externas')
                    .update({ par_item_id: created.item_id })
                    .eq('marketplace_id', marketplace_id)
                    .eq('external_item_id', createdCatalog.item_id)
                    .eq('external_variation_id', '0');
            }
            await supabaseAdmin.rpc('recalcular_catalog_count', { p_account_id: marketplace_id, p_item_ids: newItemIds });
            await supabaseAdmin.rpc('recalcular_associated_count', { p_account_id: marketplace_id, p_item_ids: newItemIds });
            trace.paso_14_link = { ok: true, item_ids: newItemIds };
        } catch (e: any) {
            trace.paso_14_link = { error: e.message };
        }

        // -- 16. Actualizar articulos.publicacion_ml solo si estaba vacío ---------
        if (resolvedArticuloId && !articulo?.publicacion_ml) {
            const { error: artUpdateErr } = await supabaseAdmin
                .from('articulos')
                .update({ publicacion_ml: created.item_id })
                .eq('articulo_id', resolvedArticuloId);
            trace.paso_16_articulo_update = artUpdateErr
                ? { error: artUpdateErr.message }
                : { publicacion_ml: created.item_id };
        } else {
            trace.paso_16_articulo_update = articulo?.publicacion_ml
                ? { omitido: 'Ya tiene publicacion_ml asignada', existente: articulo.publicacion_ml }
                : { omitido: 'Sin articulo_id vinculado' };
        }

        // -- 16b. Persistir codigo_sat si el operador lo capturó/editó -----------
        const satTrimmed = fiscal_data?.sat_key != null ? String(fiscal_data.sat_key).trim() : '';
        if (
            resolvedArticuloId &&
            !createdNewCatalogArticle &&
            fiscal_data?.enabled !== false &&
            fiscal_data?.save_sat_to_articulo !== false &&
            /^\d{8}$/.test(satTrimmed) &&
            satTrimmed !== (articulo?.codigo_sat || '')
        ) {
            try {
                const { error: satUpdErr } = await supabaseAdmin
                    .from('articulos')
                    .update({ codigo_sat: satTrimmed, origin: 'web' })
                    .eq('articulo_id', resolvedArticuloId);
                trace.paso_16_codigo_sat_update = satUpdErr
                    ? { error: satUpdErr.message }
                    : { codigo_sat: satTrimmed, origin: 'web' };
            } catch (satErr: any) {
                trace.paso_16_codigo_sat_update = { error: satErr?.message || String(satErr) };
            }
        }

        // -- 17. Vincular ficha técnica a la publicación tradicional ------------
        if (ficha_id && persistedIds.length > 0) {
            const { error: fichaLinkErr } = await supabaseAdmin
                .from('fichas_tecnicas')
                .update({
                    publicacion_externa_id: persistedIds[0],
                    ml_item_id:             created.item_id,
                })
                .eq('id', ficha_id);
            trace.paso_17_ficha_vinculacion = fichaLinkErr
                ? { error: fichaLinkErr.message }
                : { ok: true, publicacion_externa_id: persistedIds[0], ml_item_id: created.item_id };
        } else {
            trace.paso_17_ficha_vinculacion = ficha_id
                ? { omitido: 'Sin publicacion_id persistido' }
                : { omitido: 'No se proveyó ficha_id' };
        }

        // -- Respuesta final ---------------------------------------------------
        return NextResponse.json({
            ok: true,
            item_id:         created.item_id,
            item_id_catalogo: createdCatalog?.item_id ?? null,
            user_product_id: created.user_product_id,
            permalink:       created.permalink,
            title:           created.title,
            seller_model:    sellerInfo.model,
            articulo_id_creado: createdNewCatalogArticle ? resolvedArticuloId : null,
            articulo_id_vinculado: resolvedArticuloId,
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
            const cause = Array.isArray(meliError?.cause) ? meliError.cause : [];
            const erroresList: string[] = cause
                .filter((c: any) => c && (c.code || c.message))
                .map((c: any) => `[${c.code || 'error'}] ${c.message || ''}`);

            // Diagnóstico: exponer el estado real de la tradicional (trace.paso_12_meli_raw)
            // para saber POR QUÉ MeLi la dejó pausada sin necesidad de abrir DevTools.
            const tradRaw = trace.paso_12_meli_raw;
            if (tradRaw && typeof tradRaw === 'object') {
                erroresList.push(
                    `[diagnóstico] tradicional=${tradRaw.id || '?'} status=${tradRaw.status || '?'} sub_status=${JSON.stringify(tradRaw.sub_status || [])} tags=${JSON.stringify(tradRaw.tags || [])}`
                );
            }

            return NextResponse.json({
                ok: false,
                error: 'MeLi rechazó la publicación (validation_error)',
                meli_status: 400,
                meli_error: meliError,
                meli_message: typeof meliError?.message === 'string' ? meliError.message : null,
                errores: erroresList,
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
