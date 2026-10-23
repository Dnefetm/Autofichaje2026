import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/logistica-full/sync-lote — encola hasta 50 inventory_id en jobs sync_inventory,
// en el orden de urgencia de la pantalla, sin repetir (dedup por job pendiente + < 1h).
// Set-based: 3 consultas en total (no 1 query por item) para responder en ~150ms.
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const items = Array.isArray(body?.items) ? body.items : [];
        if (!items.length) return NextResponse.json({ success: false, error: 'items requerido' }, { status: 400 });
        if (items.length > 50) return NextResponse.json({ success: false, error: 'máx 50 items' }, { status: 400 });

        const norm = items
            .map((it: any) => ({ accountId: String(it?.accountId ?? '').trim(), inventoryId: String(it?.inventoryId ?? '').trim() }))
            .filter((it: any) => it.accountId && it.inventoryId);
        if (!norm.length) {
            return NextResponse.json({ success: true, encolados: 0, omitidos_por_pendiente: 0, omitidos_por_reciente: 0 });
        }

        const inventarioIds = [...new Set(norm.map((n: any) => n.inventoryId))];
        const corte = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h

        // Dedup 1 (set-based): jobs sync_inventory pendientes.
        const { data: pendJobs } = await supabaseAdmin
            .from('jobs')
            .select('payload')
            .eq('type', 'sync_inventory')
            .eq('status', 'pending');
        const pendSet = new Set((pendJobs || []).map((j: any) => `${j.payload?.accountId}|${j.payload?.inventoryId}`));

        // Dedup 2 (set-based): replenishment sincronizado hace < 1h (regla).
        // Usa replenishment_updated_at (no stock_full_updated_at): el sync de catálogo
        // actualiza stock_full (aptas) pero NO el replenishment (en camino/total), así que
        // dedupear por stock_full_updated_at bloqueaba el refresh de reposición durante 1h.
        const { data: recientes } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('inventory_id, marketplace_id')
            .in('inventory_id', inventarioIds)
            .gte('replenishment_updated_at', corte);
        const recSet = new Set((recientes || []).map((p: any) => `${p.marketplace_id}|${p.inventory_id}`));

        // Filtrado en memoria (rápido).
        let omitidosPend = 0;
        let omitidosRec = 0;
        const aEncolar: { accountId: string; inventoryId: string }[] = [];
        for (const n of norm) {
            const key = `${n.accountId}|${n.inventoryId}`;
            if (pendSet.has(key)) { omitidosPend++; continue; }
            if (recSet.has(key)) { omitidosRec++; continue; }
            aEncolar.push(n);
        }

        // 1 solo insert en lote.
        if (aEncolar.length > 0) {
            const { error } = await supabaseAdmin.from('jobs').insert(
                aEncolar.map((n) => ({
                    type: 'sync_inventory',
                    payload: { accountId: n.accountId, inventoryId: n.inventoryId },
                    status: 'pending',
                    priority: 1,
                    scheduled_at: new Date().toISOString(),
                }))
            );
            if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        await dispatchWorker().catch(() => {});
        return NextResponse.json({ success: true, encolados: aEncolar.length, omitidos_por_pendiente: omitidosPend, omitidos_por_reciente: omitidosRec });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error encolando lote' }, { status: 500 });
    }
}
