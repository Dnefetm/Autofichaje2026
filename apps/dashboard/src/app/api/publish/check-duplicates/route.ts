import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkPublishDuplicates, normalizeGtins, AccountDuplicateStatus } from '@/lib/publish-duplicates';

export const dynamic = 'force-dynamic';

/**
 * POST /api/publish/check-duplicates
 *
 * Evalúa en tiempo real el semáforo de duplicados (🟢 free / 🟡 warning / 🔴 exact)
 * por cada cuenta seleccionada en PublishPanel antes de publicar.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => null);
        const marketplaceIds: string[] = Array.isArray(body?.marketplace_ids)
            ? body.marketplace_ids.filter((x: unknown): x is string => typeof x === 'string' && x.length > 0)
            : [];

        if (marketplaceIds.length === 0) {
            return NextResponse.json({ ok: true, by_account: {} });
        }

        const articuloId = typeof body?.articulo_id === 'string' && body.articulo_id.trim()
            ? body.articulo_id.trim()
            : null;
        const sellerSku = typeof body?.seller_sku === 'string' && body.seller_sku.trim()
            ? body.seller_sku.trim()
            : null;
        const gtinParsed = normalizeGtins(typeof body?.gtin === 'string' ? body.gtin : '');
        const listingTypeId = typeof body?.listing_type_id === 'string' && body.listing_type_id.trim()
            ? body.listing_type_id.trim()
            : 'gold_special';
        const cantidadRequerida = Math.max(1, Number(body?.cantidad_requerida || 1));

        if (!articuloId && !sellerSku && gtinParsed.list.length === 0) {
            const byAccount: Record<string, AccountDuplicateStatus> = {};
            for (const id of marketplaceIds) {
                byAccount[id] = {
                    marketplace_id: id,
                    level: 'free',
                    matches: [],
                    summary: 'Sin publicaciones coincidentes',
                };
            }
            return NextResponse.json({ ok: true, by_account: byAccount });
        }

        const byAccount = await checkPublishDuplicates(supabaseAdmin, {
            marketplace_ids: marketplaceIds,
            articulo_id: articuloId,
            seller_sku: sellerSku,
            gtins: gtinParsed.list,
            listing_type_id: listingTypeId,
            cantidad_requerida: cantidadRequerida,
        });

        return NextResponse.json({ ok: true, by_account: byAccount });
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err?.message || 'Error verificando duplicados' },
            { status: 500 },
        );
    }
}
