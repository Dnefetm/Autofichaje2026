import { NextRequest, NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';
import { supabaseAdmin } from '@/lib/supabase';
import { registrarAuditoria } from '@/lib/auditoria';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Gestiona "Precios mayoristas" (precio por cantidad B2B) de una publicación.
// POST { action: 'get' | 'add', marketplace_id, item_id, tiers? }
//   get: devuelve los precios del item (incluye nodos PxQ)
//   add: agrega tramos de precio por cantidad [{ id, amount, min_purchase_unit }]
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const action = body?.action;
    const marketplace_id = body?.marketplace_id;
    const item_id = body?.item_id;

    if (!marketplace_id || !item_id) {
        return NextResponse.json({ ok: false, error: 'Se requieren marketplace_id e item_id' }, { status: 400 });
    }

    const meli = new MeliAdapter();

    try {
        if (action === 'add') {
            const tiers = body?.tiers;
            if (!Array.isArray(tiers) || tiers.length === 0) {
                return NextResponse.json({ ok: false, error: 'Se requieren tiers (array de {id, amount, min_purchase_unit})' }, { status: 400 });
            }
            const result = await (meli as any).addPriceByQuantity(marketplace_id, item_id, tiers);

            // Registro de auditoría de precio (fail-safe): resolver el UUID de la publicación.
            try {
                const { data: pubRow } = await supabaseAdmin
                    .from('publicaciones_externas')
                    .select('id')
                    .eq('marketplace_id', marketplace_id)
                    .eq('external_item_id', item_id)
                    .eq('external_variation_id', '0')
                    .limit(1)
                    .maybeSingle();
                if (pubRow?.id) {
                    await registrarAuditoria(pubRow.id, 'precio', 'precio_mayorista', { tiers: tiers.length });
                }
            } catch { /* fail-safe */ }

            return NextResponse.json({ ok: true, result });
        }

        // default: get
        const prices = await (meli as any).getItemPrices(marketplace_id, item_id);
        return NextResponse.json({ ok: true, prices });
    } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || 'Error';
        const cause = err?.response?.data?.cause || [];
        return NextResponse.json({ ok: false, error: msg, cause }, { status: 400 });
    }
}
