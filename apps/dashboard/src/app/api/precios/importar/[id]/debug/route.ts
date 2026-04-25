import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;

    const { count: rawCount } = await supabaseAdmin
        .from('listas_precios_raw')
        .select('*', { count: 'exact', head: true })
        .eq('importacion_id', id);

    const { count: costosCount } = await supabaseAdmin
        .from('costos_articulo')
        .select('*', { count: 'exact', head: true })
        .eq('importacion_id', id);

    const { count: decisCount } = await supabaseAdmin
        .from('matching_decisiones')
        .select('*', { count: 'exact', head: true })
        .eq('importacion_id', id);

    return NextResponse.json({ rawCount, costosCount, decisCount });
}
