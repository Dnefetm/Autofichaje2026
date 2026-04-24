import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    // Buscar qué importacion_id tiene datos en matching_decisiones
    const { data: mData } = await supabaseAdmin
        .from('matching_decisiones')
        .select('importacion_id')
        .limit(1)
        .single();

    if (!mData) {
        return NextResponse.json({ ok: false, error: 'No hay datos en matching_decisiones' });
    }

    const targetId = mData.importacion_id;

    // Check current state
    const { data: current } = await supabaseAdmin
        .from('importaciones_excel')
        .select('estado, proveedor')
        .eq('id', targetId)
        .single();

    if (!current) {
        return NextResponse.json({ ok: false, version: 5, error: 'Not found in importaciones' });
    }

    let state = current.estado;
    
    if (state === 'completado') {
        await supabaseAdmin.from('importaciones_excel').update({ estado: 'mapeando' }).eq('id', targetId);
        state = 'mapeando';
    }
    
    if (state === 'mapeando' || state === 'procesando') {
        await supabaseAdmin.from('importaciones_excel').update({ estado: 'matching_completo' }).eq('id', targetId);
        state = 'matching_completo';
    }

    if (state === 'error') {
        await supabaseAdmin.from('importaciones_excel').update({ estado: 'mapeando' }).eq('id', targetId);
        await supabaseAdmin.from('importaciones_excel').update({ estado: 'matching_completo' }).eq('id', targetId);
        state = 'matching_completo';
    }

    return NextResponse.json({ ok: true, version: 5, targetId, initial_state: current.estado, final_state: state });
}
