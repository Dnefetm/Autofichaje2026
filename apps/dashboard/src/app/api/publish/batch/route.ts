import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/publish/batch
 * Encola una publicación por ítem (job type 'publish_item').
 * El worker (api/worker/process) drena la cola y llama al motor /api/publish por ítem.
 * No procesa aquí (evita el timeout de 30-60s de Vercel).
 *
 * Body: { items: [ { articulo_id, marketplace_id, stock_override?, compatibilities?, ... } ] }
 */
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const items: any[] = body?.items;

    if (!Array.isArray(items) || items.length === 0) {
        return NextResponse.json({ ok: false, error: 'Se requiere items[] con al menos un elemento' }, { status: 400 });
    }

    // Validación mínima por ítem (misma regla que /api/publish)
    const invalidos = items
        .map((it, i) => {
            const tieneFuente = !!(it && it.source_marketplace_id && it.source_item_id);
            const motivo = !it?.articulo_id && !tieneFuente ? 'falta articulo_id (o fuente)' : !it?.marketplace_id ? 'falta marketplace_id' : null;
            return motivo ? { indice: i, motivo } : null;
        })
        .filter(Boolean);

    if (invalidos.length > 0) {
        return NextResponse.json({ ok: false, error: 'Ítems inválidos', invalidos }, { status: 400 });
    }

    const rows = items.map((it) => ({
        type: 'publish_item',
        payload: it,
        status: 'pending',
        priority: 1,
    }));

    const { data, error } = await supabaseAdmin.from('jobs').insert(rows).select('id');
    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, enqueued: rows.length, job_ids: (data || []).map((r: any) => r.id) });
}
