import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// POST /api/pricing/recalcular-lote
// Recalcula un lote de publicaciones pendientes (nunca approved ni override manual).
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const ids = body.ids;

        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'ids es obligatorio' }, { status: 400 });
        }

        const { data, error } = await supabaseAdmin.rpc('fn_recalcular_urgencia_lote', {
            p_ids: ids
        });

        if (error) {
            throw error;
        }

        return NextResponse.json({ success: true, procesados: data ?? 0 });
    } catch (err: any) {
        console.error('[POST /api/pricing/recalcular-lote]', err);
        return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
    }
}
