import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

// GET /api/logistica-full/avisos — lista los avisos de movimientos bloqueados.
export async function GET() {
    const { data, error } = await supabaseAdmin
        .from('avisos_movimientos')
        .select('*')
        .order('creado_el', { ascending: false })
        .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, avisos: data || [] });
}

// PATCH /api/logistica-full/avisos — marca avisos como atendidos.
export async function PATCH(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
        if (ids.length === 0) return NextResponse.json({ error: 'ids requeridos' }, { status: 400 });
        const { data, error } = await supabaseAdmin
            .from('avisos_movimientos')
            .update({ atendido: true })
            .in('id', ids)
            .select('id');
        if (error) throw error;
        return NextResponse.json({ success: true, atendidos: (data || []).length });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error actualizando avisos' }, { status: 500 });
    }
}
