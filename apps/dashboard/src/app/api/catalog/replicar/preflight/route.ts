import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
    checkPublishDuplicates,
    checkConditionalGtinRequirement,
    extractGtinCaps,
    mergeConditionalGtinCaps,
    normalizeGtins,
} from '@/lib/publish-duplicates';
import { normalizeReplicationPolicies, PreflightItem } from '@/lib/replication-batch';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function runPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (idx < items.length) {
            const current = idx++;
            results[current] = await fn(items[current]);
        }
    });
    await Promise.all(workers);
    return results;
}

/**
 * POST /api/catalog/replicar/preflight
 *
 * Pre-vuelo de hasta 50 publicaciones antes de encolar un lote de replicación:
 *  - Semáforo 3 niveles en cuenta destino
 *  - GTIN condicional real por (category_id + brand), rescatando articulos.codigo_universal
 *  - Precio calculado para cuenta destino (Motor V2) vs origen
 *  - Guardia Full y Buffer anti-sobreventa stock=1
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => null);
        const sourceId = body?.source_marketplace_id?.trim() || '';
        const targetId = body?.target_marketplace_id?.trim() || '';
        const rawIds: string[] = Array.isArray(body?.publicacion_ids) ? body.publicacion_ids : [];
        const pubIds = Array.from(new Set(rawIds.map((s) => String(s || '').trim()).filter(Boolean)));

        if (!sourceId || !targetId) {
            return NextResponse.json({ ok: false, error: 'Se requieren source_marketplace_id y target_marketplace_id' }, { status: 400 });
        }
        if (sourceId === targetId) {
            return NextResponse.json({ ok: false, error: 'La cuenta origen y destino no pueden ser iguales' }, { status: 400 });
        }
        if (pubIds.length === 0 || pubIds.length > 50) {
            return NextResponse.json({ ok: false, error: 'Selecciona entre 1 y 50 publicaciones por bloque' }, { status: 400 });
        }

        const policies = normalizeReplicationPolicies(body?.policies);

        // 1. Carga agrupada en BD (0 N+1)
        const [{ data: pubs, error: pubErr }, { data: maps }] = await Promise.all([
            supabaseAdmin
                .from('publicaciones_externas')
                .select(`
                    id, marketplace_id, external_item_id, titulo, url_imagen,
                    precio_venta, stock_publicado, listing_type_id, category_id,
                    logistic_type, seller_sku, seller_custom_field, brand, model,
                    gtin, ean, id_producto_catalogo, pictures_count
                `)
                .in('id', pubIds),
            supabaseAdmin
                .from('mapeo_publicacion_articulo')
                .select('publicacion_id, articulo_id, cantidad_requerida, articulos(articulo_id, nombre, marca, modelo, codigo_universal, codigo_sat, imagenes)')
                .in('publicacion_id', pubIds),
        ]);

        if (pubErr) {
            return NextResponse.json({ ok: false, error: pubErr.message }, { status: 500 });
        }

        const pubRows = pubs || [];
        const mapByPub = new Map<string, any>();
        const artIds: string[] = [];
        for (const m of maps || []) {
            if (!mapByPub.has(m.publicacion_id)) mapByPub.set(m.publicacion_id, m);
            if (m.articulo_id) artIds.push(m.articulo_id);
        }

        const itemIds = pubRows.map((p: any) => p.external_item_id).filter(Boolean);
        const [{ data: invRows }, { data: childRows }, { data: varRows }] = await Promise.all([
            artIds.length > 0
                ? supabaseAdmin
                    .from('inventory_snapshot')
                    .select('sku, physical_stock, dropship_stock, reserved_stock')
                    .in('sku', Array.from(new Set(artIds)))
                : Promise.resolve({ data: [] as any[] }),
            itemIds.length > 0
                ? supabaseAdmin
                    .from('publicaciones_externas')
                    .select('par_item_id, id_producto_catalogo')
                    .eq('marketplace_id', sourceId)
                    .in('par_item_id', itemIds)
                    .not('id_producto_catalogo', 'is', null)
                    .neq('status_externo', 'closed')
                : Promise.resolve({ data: [] as any[] }),
            itemIds.length > 0
                ? supabaseAdmin
                    .from('publicaciones_externas')
                    .select('external_item_id')
                    .eq('marketplace_id', sourceId)
                    .in('external_item_id', itemIds)
                    .neq('external_variation_id', '0')
                    .neq('status_externo', 'closed')
                : Promise.resolve({ data: [] as any[] }),
        ]);

        const invBySku = new Map<string, number>();
        for (const inv of invRows || []) {
            invBySku.set(inv.sku, Math.max(0, Number(inv.physical_stock || 0) + Number(inv.dropship_stock || 0) - Number(inv.reserved_stock || 0)));
        }
        const catChildByPar = new Map<string, string>();
        for (const c of childRows || []) {
            if (c.par_item_id && c.id_producto_catalogo && !catChildByPar.has(c.par_item_id)) {
                catChildByPar.set(c.par_item_id, c.id_producto_catalogo);
            }
        }
        const varCountByItem = new Map<string, number>();
        for (const v of varRows || []) {
            varCountByItem.set(v.external_item_id, (varCountByItem.get(v.external_item_id) || 0) + 1);
        }

        // 2. Deduplicar consultas de atributos/GTIN condicional por (category_id) y (category_id + brand)
        const uniqueCats = Array.from(new Set(pubRows.map((p: any) => p.category_id).filter(Boolean) as string[]));
        const baseCapsByCat = new Map<string, ReturnType<typeof extractGtinCaps>>();
        await runPool(uniqueCats, 6, async (catId) => {
            try {
                const r = await fetch(`https://api.mercadolibre.com/categories/${encodeURIComponent(catId)}/attributes`, {
                    signal: AbortSignal.timeout(4000),
                });
                if (r.ok) {
                    const attrs = await r.json();
                    baseCapsByCat.set(catId, extractGtinCaps(attrs));
                }
            } catch { /* fallback sin bloqueo */ }
        });

        const catBrandPairs = Array.from(new Set(
            pubRows
                .filter((p: any) => p.category_id)
                .map((p: any) => {
                    const m = mapByPub.get(p.id);
                    const art = m?.articulos ? (Array.isArray(m.articulos) ? m.articulos[0] : m.articulos) : null;
                    const brand = String(p.brand || art?.marca || '').trim();
                    return `${p.category_id}||${brand}||${p.listing_type_id || 'gold_special'}`;
                }),
        ));
        const mergedCapsByPair = new Map<string, ReturnType<typeof mergeConditionalGtinCaps>>();
        await runPool(catBrandPairs, 5, async (pairKey) => {
            const [catId, brand, ltype] = pairKey.split('||');
            const base = baseCapsByCat.get(catId);
            if (!base) return;
            if (!base.has_empty_reason) {
                mergedCapsByPair.set(pairKey, base);
                return;
            }
            const cond = await checkConditionalGtinRequirement({
                category_id: catId,
                brand: brand || null,
                listing_type_id: ltype,
            });
            mergedCapsByPair.set(pairKey, mergeConditionalGtinCaps(base, brand || null, cond));
        });

        // 3. Evaluar cada fila en paralelo controlado
        const preflightItems: PreflightItem[] = await runPool(pubRows, 10, async (p: any) => {
            const m = mapByPub.get(p.id);
            const art = m?.articulos ? (Array.isArray(m.articulos) ? m.articulos[0] : m.articulos) : null;
            const artId: string | null = m?.articulo_id ?? null;
            const packQty = Math.max(1, Number(m?.cantidad_requerida || 1));

            const rawSku = String(p.seller_custom_field || p.seller_sku || art?.modelo || '').trim();
            const effectiveSku = rawSku && !/^[0-9a-f]{8}$/i.test(rawSku) ? rawSku : null;
            const rawGtin = String(p.gtin || p.ean || art?.codigo_universal || '').trim();
            const parsedGtin = normalizeGtins(rawGtin);
            const effectiveGtin = parsedGtin.joined || null;
            const effectiveCatalogId = p.id_producto_catalogo || catChildByPar.get(p.external_item_id) || null;
            const variationsCount = varCountByItem.get(p.external_item_id) || 0;
            const brand = String(p.brand || art?.marca || '').trim() || null;

            const warnings: string[] = [];
            const blockers: string[] = [];

            // Duplicado en destino
            const dupMap = await checkPublishDuplicates(supabaseAdmin, {
                marketplace_ids: [targetId],
                articulo_id: artId,
                seller_sku: effectiveSku,
                gtins: parsedGtin.list,
                listing_type_id: p.listing_type_id || 'gold_special',
                cantidad_requerida: packQty,
            });
            const dup = dupMap[targetId];
            if (dup?.level === 'exact') {
                warnings.push(`Ya existe en destino (${dup.matches[0]?.external_item_id}); se vinculará sin duplicar salvo que fuerces.`);
            } else if (dup?.level === 'warning') {
                warnings.push(dup.summary);
            }

            // GTIN condicional
            let gtinStatus: PreflightItem['gtin_status'] = 'ok';
            let gtinNote: string | null = null;
            if (parsedGtin.invalid.length > 0 && parsedGtin.list.length === 0) {
                gtinStatus = 'invalid';
                gtinNote = `GTIN inválido en origen/artículo: ${parsedGtin.invalid.join(', ')}`;
                blockers.push(gtinNote);
            } else if (!effectiveGtin) {
                const pairKey = `${p.category_id || ''}||${brand || ''}||${p.listing_type_id || 'gold_special'}`;
                const caps = mergedCapsByPair.get(pairKey);
                if (caps && !caps.allows_empty_gtin) {
                    gtinStatus = 'missing_required_for_brand';
                    gtinNote = caps.gtin_required_for_brand
                        ? `MeLi exige GTIN obligatorio para marca "${brand || 'desconocida'}" en ${p.category_id}`
                        : `Categoría ${p.category_id} exige GTIN obligatorio (no admite Sin GTIN)`;
                    blockers.push(gtinNote);
                } else {
                    gtinStatus = 'missing_optional';
                    gtinNote = 'Sin GTIN registrado; se intentará como Sin GTIN / Kit si la categoría lo permite.';
                    warnings.push(gtinNote);
                }
            } else if (!p.gtin && art?.codigo_universal) {
                gtinNote = `GTIN rescatado de Catálogo Maestro (${effectiveGtin})`;
            }

            // Imágenes y variaciones
            const hasPics = Boolean(p.url_imagen) || (Number(p.pictures_count || 0) > 0) || (Array.isArray(art?.imagenes) && art.imagenes.length > 0);
            if (!hasPics) {
                blockers.push('Sin imágenes registradas para publicar');
            }
            if (variationsCount > 0) {
                warnings.push(`Publicación origen con ${variationsCount} variaciones: en modelo User Products se replicará la ficha base.`);
            }

            // Stock Full / Buffer anti-sobreventa
            const isFull = p.logistic_type === 'fulfillment';
            const localStock = artId ? (invBySku.get(artId) ?? 0) : null;
            const willPauseByFull = isFull && (!artId || (localStock ?? 0) <= 0);
            const willPauseByBuffer = Boolean(
                policies.stock_buffer_two_accounts &&
                localStock != null &&
                localStock <= 1 &&
                policies.initial_state_policy === 'active',
            );
            if (isFull) {
                warnings.push('Origen en Full: el stock de bodega MeLi NO se copia a otra cuenta.');
            }
            if (willPauseByBuffer) {
                warnings.push('Buffer stock ≤ 1: nacerá pausada en stock 0 para proteger la cuenta principal.');
            }

            // Precio destino
            const sourcePrice = p.precio_venta != null ? Number(p.precio_venta) : null;
            let targetPrice: number | null = sourcePrice;
            let priceSource = 'source_vidriera';
            if (policies.price_policy === 'target_engine' && artId && p.category_id) {
                const { data: rpcPrice, error: rpcErr } = await supabaseAdmin.rpc('fn_calcular_precio_prepublicacion', {
                    p_articulo_id: artId,
                    p_marketplace_id: targetId,
                    p_category_id: p.category_id,
                    p_listing_type_id: p.listing_type_id || 'gold_special',
                    p_cantidad_requerida: packQty,
                });
                if (!rpcErr && rpcPrice?.sale_price != null && Number(rpcPrice.sale_price) > 0) {
                    targetPrice = Number(rpcPrice.sale_price);
                    priceSource = 'motor_v2_destino';
                } else {
                    priceSource = sourcePrice && sourcePrice > 0 ? 'fallback_origen' : 'sin_precio';
                    warnings.push('Sin regla/costo activo para Motor V2 destino (usará precio origen o 0).');
                }
            } else if (!artId) {
                warnings.push('Sin artículo mapeado en Catálogo Maestro.');
            }
            if (!targetPrice || targetPrice <= 0) {
                blockers.push('Precio final en $0: requiere costo/regla o conservar precio origen válido.');
            }

            return {
                publicacion_id: p.id,
                external_item_id: p.external_item_id,
                titulo: p.titulo,
                url_imagen: p.url_imagen ?? null,
                brand,
                category_id: p.category_id ?? null,
                listing_type_id: p.listing_type_id ?? 'gold_special',
                logistic_type: p.logistic_type ?? null,
                articulo_id: artId,
                cantidad_requerida: packQty,
                effective_sku: effectiveSku,
                effective_gtin: effectiveGtin,
                effective_catalog_product_id: effectiveCatalogId,
                variations_count: variationsCount,
                source_price: sourcePrice,
                target_price: targetPrice,
                price_source: priceSource,
                local_stock: localStock,
                source_stock: p.stock_publicado != null ? Number(p.stock_publicado) : null,
                will_pause_by_buffer: willPauseByBuffer,
                will_pause_by_full: willPauseByFull,
                duplicate_level: dup?.level || 'free',
                duplicate_summary: dup?.summary || 'Sin coincidencias en destino',
                duplicate_item_id: dup?.matches?.[0]?.external_item_id ?? null,
                gtin_status: gtinStatus,
                gtin_note: gtinNote,
                status: blockers.length > 0 ? 'blocker' : (warnings.length > 0 ? 'warning' : 'ready'),
                warnings,
                blockers,
            };
        });

        const orderMap = new Map(pubIds.map((id, i) => [id, i]));
        preflightItems.sort((a, b) => (orderMap.get(a.publicacion_id) ?? 0) - (orderMap.get(b.publicacion_id) ?? 0));

        const summary = {
            total: preflightItems.length,
            ready: preflightItems.filter(i => i.status === 'ready').length,
            with_warnings: preflightItems.filter(i => i.status === 'warning').length,
            blocked: preflightItems.filter(i => i.status === 'blocker').length,
            duplicates_exact: preflightItems.filter(i => i.duplicate_level === 'exact').length,
            with_catalog: preflightItems.filter(i => Boolean(i.effective_catalog_product_id)).length,
            full_origin: preflightItems.filter(i => i.logistic_type === 'fulfillment').length,
        };

        return NextResponse.json({ ok: true, policies, summary, items: preflightItems });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'Error en pre-vuelo de replicación' }, { status: 500 });
    }
}
