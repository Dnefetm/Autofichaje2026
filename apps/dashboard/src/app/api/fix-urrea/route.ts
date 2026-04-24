import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    const targetId = 'c790c817-f6f5-4273-94a4-9d0ae9586576';
    
    // Check current state
    const { data: current } = await supabaseAdmin
        .from('importaciones_excel')
        .select('estado, proveedor')
        .eq('id', targetId)
        .single();

    if (!current) {
        return NextResponse.json({ ok: false, version: 4, error: 'Not found' });
    }

    // Force hops depending on current state
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

    // Final check
    const { data: final } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, proveedor, estado')
        .eq('id', targetId)
        .single();

    return NextResponse.json({ ok: true, version: 4, initial_state: current.estado, final_state: final?.estado });
}
