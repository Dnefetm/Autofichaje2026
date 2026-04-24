import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    const importacionId = 'c790c817-f6f5-4273-94a4-9d0ae9586576';
    
    const { data: mData } = await supabaseAdmin
        .from('matching_decisiones')
        .select('importacion_id')
        .order('id', { ascending: false })
        .limit(1)
        .single();
    
    const impId = mData?.importacion_id || importacionId;

    const { data, error } = await supabaseAdmin
        .from('listas_precios_raw')
        .select('payload')
        .eq('importacion_id', impId)
        .limit(5);

    return NextResponse.json({ ok: true, impId, data, error });
}
