/**
 * POST /api/publish/fix-sku
 *
 * Fix 4 (retrospectivo): Limpia el SELLER_SKU basura que publicaciones
 * ya enviadas a MeLi tienen almacenado (prefijo UUID de 8 hex chars).
 *
 * Estrategia:
 *  1. Lee publicaciones_externas donde seller_sku ~= /^[0-9a-f]{8}$/
 *  2. Para cada una, busca el artículo mapeado vía mapeo_publicacion_articulo
 *  3. Determina el SKU correcto: sku_tienda → modelo del artículo
 *  4. Si hay SKU correcto → PUT /items/{id} con SELLER_SKU limpio
 *  5. Si no hay SKU → PUT /items/{id} removiendo SELLER_SKU (value_name: '')
 *  6. Actualiza publicaciones_externas.seller_sku en BD
 *
 * Body (todos opcionales):
 * {
 *   marketplace_id?: string,   // Filtrar a 1 cuenta. Sin el campo = todas.
 *   dry_run?: boolean,          // true = solo reportar, no hacer PUT a MeLi
 *   limit?: number,             // Máx publicaciones a procesar (default 50)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import axios from 'axios';
import { decrypt } from '@gestor/shared';

export const dynamic = 'force-dynamic';

// -- Patrón de SKU basura: exactamente 8 caracteres hexadecimales ------------
const SKU_BASURA_RE = /^[0-9a-f]{8}$/i;

function esSkuBasura(sku: string | null | undefined): boolean {
    if (!sku) return false; // null/undefined no es "basura" — es ausencia
    return SKU_BASURA_RE.test(sku);
}

async function getAccessToken(marketplaceId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
        .from('marketplace_tokens')
        .select('access_token, refresh_token, expires_at')
        .eq('marketplace_id', marketplaceId)
        .single();

    if (error || !data) {
        throw new Error(`No se pudo obtener el token para la cuenta ${marketplaceId}`);
    }
    return decrypt(data.access_token);
}

export async function POST(req: NextRequest) {
    const startTime = Date.now();

    const body = await req.json().catch(() => ({}));
    const {
        marketplace_id = null as string | null,
        dry_run = false,
        limit = 50,
    } = body;

    const resultados: Array<{
        pub_id: string;
        external_item_id: string;
        marketplace_id: string;
        seller_sku_anterior: string;
        sku_correcto: string | null;
        accion: string;
        ok: boolean;
        error?: string;
    }> = [];

    try {
        // -- 1. Leer publicaciones con seller_sku basura -----------------------
        // Filtramos con SIMILAR TO (Postgres) para el patrón hex de 8 chars.
        // Supabase no expone SIMILAR TO directamente; usamos .filter con operador
        // custom 'similar' no disponible → usamos RPC o traemos y filtramos en JS.
        // OPCIÓN ELEGIDA: traer lotes y filtrar en JS (más portable, límite razonable).
        let query = supabaseAdmin
            .from('publicaciones_externas')
            .select(`
                id, external_item_id, marketplace_id, seller_sku,
                mapeo_publicacion_articulo (
                    sku_articulo
                )
            `)
            .not('seller_sku', 'is', null)
            .in('status_externo', ['active', 'paused', 'under_review'])
            .eq('external_variation_id', '0')
            .order('actualizado_el', { ascending: true })
            .limit(limit * 3); // traer más para compensar los que no sean basura

        if (marketplace_id) {
            query = query.eq('marketplace_id', marketplace_id);
        }

        const { data: pubs, error: pubErr } = await query;
        if (pubErr) throw pubErr;

        // Filtrar solo los que tienen seller_sku basura
        const contaminadas = (pubs || [])
            .filter(p => esSkuBasura(p.seller_sku))
            .slice(0, limit);

        if (contaminadas.length === 0) {
            return NextResponse.json({
                ok: true,
                mensaje: 'No se encontraron publicaciones con seller_sku basura.',
                total_revisadas: (pubs || []).length,
                contaminadas: 0,
                duracion_ms: Date.now() - startTime,
            });
        }

        // -- 2. Para cada publicación, resolver el SKU correcto ----------------
        // Agrupar por marketplace_id para reutilizar tokens
        const tokenCache = new Map<string, string>();

        const getToken = async (mkId: string): Promise<string> => {
            if (!tokenCache.has(mkId)) {
                tokenCache.set(mkId, await getAccessToken(mkId));
            }
            return tokenCache.get(mkId)!;
        };

        // Cargar articulos mapeados en batch para evitar N+1
        const articuloIds = [
            ...new Set(
                contaminadas.flatMap((p: any) =>
                    (p.mapeo_publicacion_articulo || []).map((m: any) => m.sku_articulo)
                ).filter(Boolean)
            ),
        ] as string[];

        const { data: articulos } = await supabaseAdmin
            .from('articulos')
            .select('articulo_id, modelo, marca')
            .in('articulo_id', articuloIds.length > 0 ? articuloIds : ['__none__']);

        const articuloMap = new Map((articulos || []).map((a: any) => [a.articulo_id, a]));

        // Cargar marketplace_prices para sku_tienda en batch
        const { data: precios } = await supabaseAdmin
            .from('marketplace_prices')
            .select('articulo_id, marketplace_id, sku_tienda')
            .in('articulo_id', articuloIds.length > 0 ? articuloIds : ['__none__']);

        // Map: `${articulo_id}:${marketplace_id}` → sku_tienda
        const precioMap = new Map(
            (precios || []).map((p: any) => [`${p.articulo_id}:${p.marketplace_id}`, p.sku_tienda])
        );

        // -- 3. Procesar cada publicación --------------------------------------
        for (const pub of contaminadas) {
            const mkId: string = pub.marketplace_id;
            const itemId: string = pub.external_item_id;
            const skuAnterior: string = pub.seller_sku;

            // Resolver artículo mapeado (primer mapeo encontrado)
            const primerMapeo = (pub.mapeo_publicacion_articulo as any[])?.[0];
            const articuloId: string | null = primerMapeo?.sku_articulo || null;
            const articulo = articuloId ? articuloMap.get(articuloId) : null;

            // Resolver SKU correcto: sku_tienda específico de cuenta → sku_tienda genérico → modelo
            const skuTiendaEspecifico = articuloId
                ? (precioMap.get(`${articuloId}:${mkId}`) || null)
                : null;
            const skuTiendaGenerico = articuloId
                ? ([...precioMap.entries()]
                    .find(([k]) => k.startsWith(`${articuloId}:`))
                    ?.[1] || null)
                : null;
            const modelo = articulo?.modelo || null;

            const skuCorrecto: string | null =
                skuTiendaEspecifico || skuTiendaGenerico || modelo || null;

            let accion = '';
            let ok = false;
            let errorMsg: string | undefined;

            if (!dry_run) {
                try {
                    const accessToken = await getToken(mkId);

                    // PUT /items/{id} actualizando solo SELLER_SKU
                    // Si skuCorrecto es null, mandamos value_name vacío para limpiar el campo
                    const attributePayload = skuCorrecto
                        ? { id: 'SELLER_SKU', value_name: skuCorrecto }
                        : { id: 'SELLER_SKU', value_name: '' };

                    await axios.put(
                        `https://api.mercadolibre.com/items/${itemId}`,
                        { attributes: [attributePayload] },
                        { headers: { Authorization: `Bearer ${accessToken}` } }
                    );

                    // Actualizar seller_sku en BD
                    const { error: updateErr } = await supabaseAdmin
                        .from('publicaciones_externas')
                        .update({
                            seller_sku: skuCorrecto || null,
                            actualizado_el: new Date().toISOString(),
                        })
                        .eq('id', pub.id);

                    if (updateErr) throw updateErr;

                    accion = skuCorrecto
                        ? `SELLER_SKU actualizado a '${skuCorrecto}'`
                        : 'SELLER_SKU eliminado (sin modelo disponible)';
                    ok = true;
                } catch (err: any) {
                    accion = 'ERROR';
                    ok = false;
                    errorMsg = err.response?.data
                        ? JSON.stringify(err.response.data)
                        : err.message;
                }
            } else {
                // Dry run: solo reportar
                accion = skuCorrecto
                    ? `[DRY] Actualizaría SELLER_SKU a '${skuCorrecto}'`
                    : '[DRY] Eliminaría SELLER_SKU (sin modelo disponible)';
                ok = true;
            }

            resultados.push({
                pub_id: pub.id,
                external_item_id: itemId,
                marketplace_id: mkId,
                seller_sku_anterior: skuAnterior,
                sku_correcto: skuCorrecto,
                accion,
                ok,
                ...(errorMsg ? { error: errorMsg } : {}),
            });
        }

        const exitosos = resultados.filter(r => r.ok).length;
        const fallidos  = resultados.filter(r => !r.ok).length;

        return NextResponse.json({
            ok: true,
            dry_run,
            resumen: {
                total_revisadas: (pubs || []).length,
                contaminadas: contaminadas.length,
                exitosos,
                fallidos,
            },
            resultados,
            duracion_ms: Date.now() - startTime,
        });

    } catch (err: any) {
        return NextResponse.json({
            ok: false,
            error: err.message,
            duracion_ms: Date.now() - startTime,
        }, { status: 500 });
    }
}

/**
 * GET /api/publish/fix-sku
 *
 * Solo diagnóstico: lista las publicaciones con seller_sku basura sin tocar nada.
 * Equivalente a POST con dry_run: true sin llamar a MeLi.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const marketplace_id = searchParams.get('marketplace_id');
    const limit = parseInt(searchParams.get('limit') || '200', 10);

    let query = supabaseAdmin
        .from('publicaciones_externas')
        .select(`
            id, external_item_id, marketplace_id, seller_sku, status_externo,
            mapeo_publicacion_articulo (sku_articulo)
        `)
        .not('seller_sku', 'is', null)
        .in('status_externo', ['active', 'paused', 'under_review'])
        .eq('external_variation_id', '0')
        .limit(limit * 3);

    if (marketplace_id) {
        query = query.eq('marketplace_id', marketplace_id);
    }

    const { data: pubs, error } = await query;
    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const contaminadas = (pubs || []).filter(p => esSkuBasura(p.seller_sku)).slice(0, limit);

    return NextResponse.json({
        ok: true,
        total_con_seller_sku: (pubs || []).length,
        contaminadas: contaminadas.length,
        listado: contaminadas.map((p: any) => ({
            pub_id: p.id,
            external_item_id: p.external_item_id,
            marketplace_id: p.marketplace_id,
            seller_sku_basura: p.seller_sku,
            status: p.status_externo,
            articulo_id: p.mapeo_publicacion_articulo?.[0]?.sku_articulo || null,
        })),
    });
}
