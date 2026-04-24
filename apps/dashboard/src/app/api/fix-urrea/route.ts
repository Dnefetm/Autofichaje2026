import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    const { data, error } = await supabaseAdmin
        .from('importaciones_excel')
        .update({ estado: 'matching_completo' })
        .eq('proveedor', 'Urrea Herramientas')
        .neq('estado', 'cancelado')
        .select('id, proveedor, estado');

    if (error) {
        return NextResponse.json({ ok: false, error: error.message });
    }

    return NextResponse.json({ ok: true, data });
}
