import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1 min timeout

export async function GET(req: Request) {
    try {
        const { data: queue, error: qErr } = await supabaseAdmin
            .from('precio_recalc_queue')
            .select('id, articulo_id')
            .is('procesado_at', null)
            .order('encolado_at', { ascending: true })
            .limit(500);

        if (qErr) throw qErr;

        if (!queue || queue.length === 0) {
            return NextResponse.json({ status: 'empty' });
        }

        const ids = Array.from(new Set(queue.map(q => q.articulo_id)));

        const { error: calcErr } = await supabaseAdmin.rpc('fn_recalcular_lote', {
            p_articulo_ids: ids
        });

        if (calcErr) throw calcErr;

        const queueIds = queue.map(q => q.id);
        await supabaseAdmin
            .from('precio_recalc_queue')
            .update({ procesado_at: new Date().toISOString() })
            .in('id', queueIds);

        return NextResponse.json({ success: true, processed: queue.length });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
