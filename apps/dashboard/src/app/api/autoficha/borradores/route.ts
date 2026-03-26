import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// GET  /api/autoficha/borradores?operador=operador_1&estado=pendiente
// POST /api/autoficha/borradores — crear o actualizar borrador

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const operador = searchParams.get('operador') || 'operador_1';
    const estado   = searchParams.get('estado');   // null = todos los no-guardados

    const supabase = getSupabase();
    let query = supabase
        .from('autoficha_borradores')
        .select('id, operador_id, estado, input_mode, url_origen, archivos_storage, resultado_ia, editado, confianza, articulo_vinculado, modo_guardado, dispositivo, created_at, updated_at')
        .eq('operador_id', operador)
        .neq('estado', 'guardado')       // no mostrar los ya guardados en catálogo
        .order('updated_at', { ascending: false })
        .limit(20);

    if (estado) query = query.eq('estado', estado);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ borradores: data });
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const supabase = getSupabase();

    const { id, ...fields } = body;

    if (id) {
        // PATCH — actualizar borrador existente
        const { data, error } = await supabase
            .from('autoficha_borradores')
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ borrador: data });
    } else {
        // CREATE — nuevo borrador
        const { data, error } = await supabase
            .from('autoficha_borradores')
            .insert({ operador_id: 'operador_1', ...fields })
            .select()
            .single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ borrador: data }, { status: 201 });
    }
}
