import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/catalog/replicar/candidates
 *
 * Lista candidatas para replicar desde una cuenta origen hacia una destino:
 *  - Si viene `?ids=uuid1,uuid2,...`, carga esa selección directa (desde Vitrinas) hasta 50 ítems.
 *  - Si no, ejecuta `fn_publicaciones_pendientes_replicar` (consulta asimétrica indexada).
 *  - Con `include_facets=1`, retorna marcas y categorías de la cuenta origen para filtros.
 */
export async function GET(req: NextRequest) {
    try {
        const sp = req.nextUrl.searchParams;
        const sourceId = sp.get('source_marketplace_id')?.trim() || '';
        const targetId = sp.get('target_marketplace_id')?.trim() || '';
        const idsParam = sp.get('ids')?.trim() || '';
        const search = sp.get('search')?.trim() || null;
        const brand = sp.get('brand')?.trim() || null;
        const categoryId = sp.get('category_id')?.trim() || null;
        const catalogFilter = sp.get('catalog_filter')?.trim() || 'all';
        const mappedFilter = sp.get('mapped_filter')?.trim() || 'all';
        const stockFilter = sp.get('stock_filter')?.trim() || 'all';
        const limit = Math.min(Math.max(parseInt(sp.get('limit') || '50', 10) || 50, 1), 100);
        const offset = Math.max(parseInt(sp.get('offset') || '0', 10) || 0, 0);
        const includeFacets = sp.get('include_facets') === '1';

        let facets: { brands: string[]; categories: string[] } | undefined;
        if (includeFacets && sourceId) {
            const { data: facetRows } = await supabaseAdmin
                .from('publicaciones_externas')
                .select('brand, category_id')
                .eq('marketplace_id', sourceId)
                .eq('external_variation_id', '0')
                .eq('status_externo', 'active')
                .in('tipo_publicacion', ['tradicional', 'up'])
                .limit(4000);
            const brandSet = new Set<string>();
            const catSet = new Set<string>();
            for (const r of facetRows || []) {
                if (r.brand && String(r.brand).trim()) brandSet.add(String(r.brand).trim());
                if (r.category_id && String(r.category_id).trim()) catSet.add(String(r.category_id).trim());
            }
            facets = {
                brands: Array.from(brandSet).sort((a, b) => a.localeCompare(b, 'es')),
                categories: Array.from(catSet).sort(),
            };
        }

        // Modo selección directa desde /catalog/external?ids=...
        if (idsParam) {
            const ids = Array.from(new Set(idsParam.split(',').map(s => s.trim()).filter(Boolean))).slice(0, 50);
            if (ids.length === 0) {
                return NextResponse.json({ ok: true, items: [], total_count: 0, ...(facets ? { facets } : {}) });
            }

            const { data: pubs, error: pubsErr } = await supabaseAdmin
                .from('publicaciones_externas')
                .select(`
                    id, marketplace_id, external_item_id, titulo, url_imagen, permalink,
                    precio_venta, stock_publicado, status_externo, listing_type_id,
                    category_id, domain_id, logistic_type, free_shipping, seller_sku,
                    seller_custom_field, brand, model, gtin, es_bundle, esta_mapeado,
                    id_producto_catalogo
                `)
                .in('id', ids);

            if (pubsErr) {
                return NextResponse.json({ ok: false, error: pubsErr.message }, { status: 500 });
            }

            const rows = pubs || [];
            const pubIds = rows.map((p: any) => p.id);
            const itemIds = rows.map((p: any) => p.external_item_id).filter(Boolean);
            const srcAccount = sourceId || rows[0]?.marketplace_id || null;

            const { data: mapRows } = pubIds.length > 0
                ? await supabaseAdmin
                    .from('mapeo_publicacion_articulo')
                    .select('publicacion_id, articulo_id, cantidad_requerida, articulos(articulo_id, nombre, codigo_universal, codigo_sat)')
                    .in('publicacion_id', pubIds)
                : { data: [] as any[] };

            const mapByPub = new Map<string, any>();
            const artIds: string[] = [];
            for (const m of mapRows || []) {
                if (!mapByPub.has(m.publicacion_id)) mapByPub.set(m.publicacion_id, m);
                if (m.articulo_id) artIds.push(m.articulo_id);
            }

            const [{ data: invRows }, { data: childRows }, { data: varRows }] = await Promise.all([
                artIds.length > 0
                    ? supabaseAdmin
                        .from('inventory_snapshot')
                        .select('sku, physical_stock, dropship_stock, reserved_stock')
                        .in('sku', Array.from(new Set(artIds)))
                    : Promise.resolve({ data: [] as any[] }),
                srcAccount && itemIds.length > 0
                    ? supabaseAdmin
                        .from('publicaciones_externas')
                        .select('par_item_id, id_producto_catalogo, status_externo')
                        .eq('marketplace_id', srcAccount)
                        .in('par_item_id', itemIds)
                        .not('id_producto_catalogo', 'is', null)
                        .neq('status_externo', 'closed')
                    : Promise.resolve({ data: [] as any[] }),
                srcAccount && itemIds.length > 0
                    ? supabaseAdmin
                        .from('publicaciones_externas')
                        .select('external_item_id')
                        .eq('marketplace_id', srcAccount)
                        .in('external_item_id', itemIds)
                        .neq('external_variation_id', '0')
                        .neq('status_externo', 'closed')
                    : Promise.resolve({ data: [] as any[] }),
            ]);

            const invBySku = new Map<string, number>();
            for (const inv of invRows || []) {
                const avail = Math.max(0, Number(inv.physical_stock || 0) + Number(inv.dropship_stock || 0) - Number(inv.reserved_stock || 0));
                invBySku.set(inv.sku, avail);
            }
            const catByPar = new Map<string, string>();
            for (const c of childRows || []) {
                if (c.par_item_id && c.id_producto_catalogo && !catByPar.has(c.par_item_id)) {
                    catByPar.set(c.par_item_id, c.id_producto_catalogo);
                }
            }
            const varCountByItem = new Map<string, number>();
            for (const v of varRows || []) {
                varCountByItem.set(v.external_item_id, (varCountByItem.get(v.external_item_id) || 0) + 1);
            }

            const items = rows.map((p: any) => {
                const m = mapByPub.get(p.id);
                const art = m?.articulos ? (Array.isArray(m.articulos) ? m.articulos[0] : m.articulos) : null;
                const rawSku = (p.seller_custom_field || p.seller_sku || '').trim();
                const cleanSku = rawSku && !/^[0-9a-f]{8}$/i.test(rawSku) ? rawSku : null;
                return {
                    publicacion_id: p.id,
                    external_item_id: p.external_item_id,
                    titulo: p.titulo,
                    url_imagen: p.url_imagen,
                    permalink: p.permalink,
                    precio_venta: p.precio_venta,
                    stock_publicado: p.stock_publicado,
                    status_externo: p.status_externo,
                    listing_type_id: p.listing_type_id,
                    category_id: p.category_id,
                    domain_id: p.domain_id,
                    logistic_type: p.logistic_type,
                    free_shipping: Boolean(p.free_shipping),
                    seller_sku: cleanSku,
                    brand: p.brand,
                    model: p.model,
                    gtin: p.gtin,
                    es_bundle: Boolean(p.es_bundle),
                    esta_mapeado: Boolean(m?.articulo_id || p.esta_mapeado),
                    effective_catalog_product_id: p.id_producto_catalogo || catByPar.get(p.external_item_id) || null,
                    variations_count: varCountByItem.get(p.external_item_id) || 0,
                    articulo_id: m?.articulo_id ?? null,
                    cantidad_requerida: m?.cantidad_requerida ?? 1,
                    articulo_nombre: art?.nombre ?? null,
                    articulo_codigo_universal: art?.codigo_universal ?? null,
                    articulo_codigo_sat: art?.codigo_sat ?? null,
                    local_stock: m?.articulo_id ? (invBySku.get(m.articulo_id) ?? 0) : null,
                    total_count: rows.length,
                };
            });

            return NextResponse.json({
                ok: true,
                mode: 'selected_ids',
                items,
                total_count: items.length,
                ...(facets ? { facets } : {}),
            });
        }

        // Modo descubrimiento asimétrico vía RPC
        if (!sourceId || !targetId) {
            return NextResponse.json({ ok: false, error: 'Se requieren source_marketplace_id y target_marketplace_id' }, { status: 400 });
        }
        if (sourceId === targetId) {
            return NextResponse.json({ ok: false, error: 'La cuenta origen y destino deben ser distintas' }, { status: 400 });
        }

        const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('fn_publicaciones_pendientes_replicar', {
            p_source_marketplace_id: sourceId,
            p_target_marketplace_id: targetId,
            p_search: search,
            p_brand: brand,
            p_category_id: categoryId,
            p_catalog_filter: catalogFilter,
            p_mapped_filter: mappedFilter,
            p_stock_filter: stockFilter,
            p_limit: limit,
            p_offset: offset,
        });

        if (rpcErr) {
            return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
        }

        const items = Array.isArray(rpcData) ? rpcData : [];
        const totalCount = items.length > 0 ? Number(items[0].total_count || items.length) : 0;

        return NextResponse.json({
            ok: true,
            mode: 'discovery',
            items,
            total_count: totalCount,
            ...(facets ? { facets } : {}),
        });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err?.message || 'Error listando candidatas' }, { status: 500 });
    }
}
