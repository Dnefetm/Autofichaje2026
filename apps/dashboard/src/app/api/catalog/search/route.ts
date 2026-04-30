import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    
    if (!q || q.length < 2) {
        return NextResponse.json({ articulos: [] });
    }

    // Try finding by exact EAN/UPC first
    let { data, error } = await supabaseAdmin
        .from('articulos')
        .select('id, titulo, marca, modelo, codigo_universal')
        .eq('codigo_universal', q)
        .limit(5);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If no exact match, try ilike on model or title
    if (!data || data.length === 0) {
        const { data: fuzzyData, error: fuzzyError } = await supabaseAdmin
            .from('articulos')
            .select('id, titulo, marca, modelo, codigo_universal')
            .or(`modelo.ilike.%${q}%,titulo.ilike.%${q}%,marca.ilike.%${q}%`)
            .limit(10);
            
        if (fuzzyError) {
            return NextResponse.json({ error: fuzzyError.message }, { status: 500 });
        }
        data = fuzzyData;
    }

    return NextResponse.json({ articulos: data || [] });
}
