import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    const { data, error } = await supabaseAdmin
        .from('importaciones_excel')
        .update({ estado: 'matching_completo' })
        .eq('proveedor', 'Urrea Herramientas')
        .in('estado', ['mapeando', 'completado', 'procesando'])
        .select('id, proveedor, estado');

    if (error) {
        return NextResponse.json({ ok: false, version: 2, error: error.message });
    }

    return NextResponse.json({ ok: true, version: 2, data });
}
