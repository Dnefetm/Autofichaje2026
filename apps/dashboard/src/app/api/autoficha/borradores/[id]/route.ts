import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// DELETE /api/autoficha/borradores/[id]
// PATCH  /api/autoficha/borradores/[id]  (estado=guardado al completar)

function getSupabase() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    const supabase = getSupabase();
    const { error } = await supabase.from('autoficha_borradores').delete().eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    const body = await req.json();
    const supabase = getSupabase();
    const { data, error } = await supabase
        .from('autoficha_borradores')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('id', params.id)
        .select()
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ borrador: data });
}
