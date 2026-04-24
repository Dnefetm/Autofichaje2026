import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    // First, move to 'mapeando' to satisfy the state machine transition rule
    await supabaseAdmin
        .from('importaciones_excel')
        .update({ estado: 'mapeando' })
        .eq('proveedor', 'Urrea Herramientas')
        .in('estado', ['completado']);

    // Then move to 'matching_completo'
    const { data, error } = await supabaseAdmin
        .from('importaciones_excel')
        .update({ estado: 'matching_completo' })
        .eq('proveedor', 'Urrea Herramientas')
        .in('estado', ['mapeando', 'procesando'])
        .select('id, proveedor, estado');

    if (error) {
        return NextResponse.json({ ok: false, version: 3, error: error.message });
    }

    return NextResponse.json({ ok: true, version: 3, data });
}
