/**
 * POST /api/publish/new-condition
 *
 * "Nueva condición de venta" sobre la API OFICIAL de MeLi (NO el endpoint BOMNI,
 * que está blindado con token anti-bot "armor" y no es replicable).
 *
 * Qué hace MeLi internamente cuando el vendedor pulsa "Agregar condición de venta":
 * crea un SEGUNDO ítem con el mismo producto (mismo catalog_product_id / GTIN / SKU)
 * pero con otro listing_type_id y/u otro shipping.free_shipping. MeLi los agrupa
 * automáticamente en la página del producto bajo "Otras condiciones de venta"
 * porque comparten producto + vendedor + seller_custom_field.
 *
 * Este endpoint replica exactamente eso:
 *   1. GET /items/{item_id}        → lee el ítem existente (identidad completa)
 *   2. POST /items                 → crea el 2º ítem con la MISMA identidad
 *                                     (mismo SKU/seller_custom_field, mismas fotos,
 *                                     mismos atributos, misma categoría) y SOLO cambia
 *                                     listing_type_id + free_shipping (+ precio/stock opcional)
 *   3. Persiste en publicaciones_externas + mapeo_publicacion_articulo
 *   4. Copia la descripción si existe
 *
 * Body esperado:
 * {
 *   marketplace_id: string,      // UUID de la cuenta MeLi (marketplace_configs.id)
 *   item_id: string,             // MLMxxxxxxxx del ítem a derivar
 *   listing_type_id: string,     // gold_special (Clásica) | gold_pro (Premium)
 *   free_shipping: boolean,      // envío gratis de la nueva condición
 *   price_override?: number,     // opcional: precio distinto al del ítem original
 *   stock_override?: number,     // opcional: stock distinto
 *   articulo_id?: string,        // opcional: UUID del artículo para enlazar (mapeo)
 *   dry_run?: boolean            // si true, construye el body pero NO publica
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

// Atributos que NO deben copiarse del ítem original (obsoletos / auto-generados por MeLi).
const SKIP_ATTRS = new Set(['EXCLUSIVE_CHANNEL']);

// Sale terms que sí tienen sentido copiar a la nueva condición.
const COPY_SALE_TERMS = new Set(['WARRANTY_TYPE', 'WARRANTY_TIME', 'MANUFACTURING_TIME']);

export async function POST(req: NextRequest) {
    const start = Date.now();
    const trace: Record<string, any> = {};

    try {
        const body = await req.json().catch(() => null);
        if (!body || !body.marketplace_id || !body.item_id || !body.listing_type_id) {
            return NextResponse.json(
                { ok: false, error: 'Se requieren marketplace_id, item_id y listing_type_id en el body' },
                { status: 400 },
            );
        }

        const {
            marketplace_id,
            item_id,
            listing_type_id,
            free_shipping = false,
            price_override = null as number | null,
            stock_override = null as number | null,
            articulo_id = null as string | null,
            dry_run = false,
        } = body;

        const meli = new MeliAdapter();

        // -- 1. Leer el ítem existente (identidad a preservar) ------------------
        const existing = await (meli as any).getItem(marketplace_id, item_id);
        trace.paso_1_existente = {
            id: existing.id,
            title: existing.title ?? null,
            family_name: existing.family_name ?? null,
            user_product_id: existing.user_product_id ?? null,
            listing_type_id: existing.listing_type_id ?? null,
            catalog_listing: existing.catalog_listing ?? false,
            catalog_product_id: existing.catalog_product_id ?? null,
            seller_custom_field: existing.seller_custom_field ?? null,
            price: existing.price ?? null,
            currency_id: existing.currency_id ?? null,
            available_quantity: existing.available_quantity ?? null,
            condition: existing.condition ?? null,
            shipping_mode: existing.shipping?.mode ?? null,
            free_shipping: existing.shipping?.free_shipping ?? false,
            pictures: existing.pictures?.length ?? 0,
            attributes: existing.attributes?.length ?? 0,
            status: existing.status ?? null,
        };

        // -- 2. Detectar modelo del seller (UP vs legacy) -----------------------
        const sellerInfo = await (meli as any).detectSellerModel(marketplace_id);
        const isLegacy = sellerInfo.model !== 'up';
        trace.paso_2_modelo = sellerInfo.model;

        // -- 3. ¿Es publicación de catálogo? ------------------------------------
        // Catalog listing = body mínimo (MeLi aporta título/fotos/atributos desde la ficha).
        const isCatalog = existing.catalog_listing === true && !!existing.catalog_product_id;

        // Las variantes (talla/color) no se replican en esta versión — avisar antes
        // de crear un ítem incompleto.
        if (Array.isArray(existing.variations) && existing.variations.length > 0) {
            return NextResponse.json({
                ok: false,
                error: 'Esta publicación tiene variaciones (talla/color). La nueva condición por variantes aún no está soportada; usa una publicación sin variaciones.',
                variaciones: existing.variations.length,
                trace,
            }, { status: 422 });
        }

        // -- 4. Construir el body del 2º ítem -----------------------------------
        const price = price_override != null && Number(price_override) > 0
            ? Number(price_override)
            : Number(existing.price ?? 0);
        const stock = stock_override != null && Number(stock_override) >= 0
            ? Number(stock_override)
            : Math.max(existing.available_quantity ?? 1, 1);

        // Atributos: copiar los del original, filtrando los obsoletos.
        const attributes = (existing.attributes || [])
            .filter((a: any) => a?.id && !SKIP_ATTRS.has(a.id))
            .map((a: any) => {
                const out: any = { id: a.id };
                if (a.value_id != null) out.value_id = String(a.value_id);
                if (a.value_name != null) out.value_name = a.value_name;
                return out;
            });

        // Mismo SKU: MeLi agrupa "condiciones" de venta por seller_custom_field.
        if (existing.seller_custom_field && !attributes.some((a: any) => a.id === 'SELLER_SKU')) {
            attributes.push({ id: 'SELLER_SKU', value_name: existing.seller_custom_field });
        }

        const pictures = (existing.pictures || [])
            .map((p: any) => p.secure_url || p.url)
            .filter(Boolean)
            .map((url: string) => ({ source: url }));

        const saleTerms = (existing.sale_terms || [])
            .filter((s: any) => COPY_SALE_TERMS.has(s.id))
            .map((s: any) => {
                let value_name = s.value_name;
                // MANUFACTURING_TIME es number_unit con unidad "días": normalizar "0" -> "0 días".
                if (s.id === 'MANUFACTURING_TIME') {
                    const m = String(value_name || '').match(/(-?\d+)/);
                    value_name = `${m ? m[1] : '0'} días`;
                }
                return { id: s.id, value_name };
            });

        const itemBody: any = isCatalog
            ? {
                category_id: existing.category_id,
                price,
                currency_id: existing.currency_id || 'MXN',
                available_quantity: stock,
                buying_mode: 'buy_it_now',
                listing_type_id,
                condition: existing.condition || 'new',
                catalog_product_id: existing.catalog_product_id,
                catalog_listing: true,
            }
            : {
                category_id: existing.category_id,
                price,
                currency_id: existing.currency_id || 'MXN',
                available_quantity: stock,
                buying_mode: 'buy_it_now',
                listing_type_id,
                shipping: {
                    mode: existing.shipping?.mode || 'me2',
                    free_shipping: !!free_shipping,
                    ...(existing.shipping?.dimensions ? { dimensions: existing.shipping.dimensions } : {}),
                },
                ...(isLegacy ? { condition: existing.condition || 'new' } : {}),
                sale_terms: saleTerms.length
                    ? saleTerms
                    : [
                        { id: 'WARRANTY_TYPE', value_name: 'Garantía del vendedor' },
                        { id: 'WARRANTY_TIME', value_name: '1 mes' },
                        { id: 'MANUFACTURING_TIME', value_name: '0 días' },
                    ],
                pictures,
                attributes,
                seller_custom_field: existing.seller_custom_field || undefined,
                // legacy: title completo. UP: family_name (MeLi genera el título).
                ...(isLegacy
                    ? { title: existing.title }
                    : { family_name: existing.family_name || existing.title }),
            };

        trace.paso_4_body = itemBody;

        // -- Validaciones ------------------------------------------------------
        if (price === 0 && !dry_run) {
            return NextResponse.json(
                { ok: false, error: 'El ítem original no tiene precio. Fija price_override antes de crear la condición.', trace },
                { status: 422 },
            );
        }
        const sameListingType = existing.listing_type_id === listing_type_id;
        const sameShipping = (existing.shipping?.free_shipping ?? false) === !!free_shipping;
        if (sameListingType && sameShipping) {
            return NextResponse.json(
                { ok: false, error: 'La nueva condición es idéntica a la actual (mismo listing_type y envío). Elige una combinación distinta.', trace },
                { status: 422 },
            );
        }

        // -- DRY RUN -----------------------------------------------------------
        if (dry_run) {
            return NextResponse.json({
                ok: true,
                dry_run: true,
                mensaje: 'Simulación completada. Para publicar envía dry_run: false.',
                duracion_ms: Date.now() - start,
                trace,
            });
        }

        // -- 5. Crear el 2º ítem en MeLi ---------------------------------------
        const created = await (meli as any).createItem(marketplace_id, itemBody);
        trace.paso_5_creado = {
            item_id: created.item_id,
            user_product_id: created.user_product_id,
            permalink: created.permalink,
            title: created.title,
            status: created.status,
        };

        // -- 6. Copiar la descripción del original (si existe) ------------------
        try {
            const desc = await (meli as any).getDescription(marketplace_id, item_id);
            if (desc) {
                await (meli as any).addDescription(marketplace_id, created.item_id, desc);
                trace.paso_6_descripcion = { ok: true, chars: desc.length };
            } else {
                trace.paso_6_descripcion = { omitido: 'El ítem original no tiene descripción' };
            }
        } catch (e: any) {
            trace.paso_6_descripcion = { error: e.message };
        }

        // -- 7. Resolver articulo_id para el mapeo ------------------------------
        let targetArticuloId = articulo_id;
        if (!targetArticuloId) {
            const { data: mapRow } = await supabaseAdmin
                .from('mapeo_publicacion_articulo')
                .select('articulo_id, publicaciones_externas!inner(external_item_id, marketplace_id)')
                .eq('publicaciones_externas.external_item_id', item_id)
                .eq('publicaciones_externas.marketplace_id', marketplace_id)
                .limit(1)
                .maybeSingle();
            targetArticuloId = mapRow?.articulo_id ?? null;
        }
        trace.paso_7_articulo = { articulo_id: targetArticuloId };

        // -- 8. Persistir publicaciones_externas -------------------------------
        const { data: pubInserted, error: pubErr } = await supabaseAdmin
            .from('publicaciones_externas')
            .upsert({
                marketplace_id,
                external_item_id: created.item_id,
                external_variation_id: '0',
                titulo: created.title,
                precio_venta: price,
                stock_publicado: stock,
                status_externo: created.status,
                permalink: created.permalink,
                listing_type_id,
                category_id: existing.category_id ?? null,
                tipo_publicacion: created.user_product_id
                    ? 'up'
                    : isCatalog ? 'catalogo' : 'tradicional',
                id_publicacion_padre: null,
                id_producto_catalogo: existing.catalog_product_id ?? null,
                es_fuente_stock: true,
                free_shipping: !!free_shipping,
                logistic_type: existing.shipping?.logistic_type ?? null,
                shipping_mode: existing.shipping?.mode ?? null,
                seller_sku: existing.seller_custom_field || null,
                condition: existing.condition ?? null,
                actualizado_el: new Date().toISOString(),
            }, { onConflict: 'marketplace_id,external_item_id,external_variation_id' })
            .select('id')
            .single();
        trace.paso_8_publicacion = pubErr ? { error: pubErr.message } : { publicacion_id: pubInserted?.id };

        // -- 9. Mapeo artículo (enlace vitrina ↔ producto del catálogo) --------
        if (pubInserted?.id && targetArticuloId) {
            const { error: mapErr } = await supabaseAdmin
                .from('mapeo_publicacion_articulo')
                .upsert({
                    publicacion_id: pubInserted.id,
                    articulo_id: targetArticuloId,
                    cantidad_requerida: 1,
                }, { onConflict: 'publicacion_id,articulo_id' });
            trace.paso_9_mapeo = mapErr ? { error: mapErr.message } : { ok: true };
        } else {
            trace.paso_9_mapeo = { omitido: 'Sin publicacion_id o articulo_id para enlazar' };
        }

        return NextResponse.json({
            ok: true,
            item_id: created.item_id,
            permalink: created.permalink,
            title: created.title,
            status: created.status,
            seller_model: sellerInfo.model,
            es_catalogo: isCatalog,
            duracion_ms: Date.now() - start,
            trace,
        });
    } catch (err: any) {
        const errMsg: string = err.message || '';
        let meliError: any = null;
        let isMeliValidation = false;
        if (errMsg.includes('400') || errMsg.includes('validation_error')) {
            try {
                const jsonStart = errMsg.indexOf('{');
                if (jsonStart !== -1) {
                    meliError = JSON.parse(errMsg.slice(jsonStart));
                    isMeliValidation = true;
                }
            } catch { /* cae al 500 genérico */ }
        }

        if (isMeliValidation) {
            return NextResponse.json({
                ok: false,
                error: 'MeLi rechazó la nueva condición (validation_error)',
                meli_status: 400,
                meli_error: meliError,
                duracion_ms: Date.now() - start,
                trace,
            }, { status: 422 });
        }

        return NextResponse.json({
            ok: false,
            error: errMsg,
            duracion_ms: Date.now() - start,
            trace,
        }, { status: 500 });
    }
}
