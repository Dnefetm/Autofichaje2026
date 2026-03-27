import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// DELETE /api/autoficha/borradores/[id]
// PATCH  /api/autoficha/borradores/[id]  (estado=guardado al completar)

// Usa service_role_key para bypassear RLS.
function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

// Next.js 15+: params es una Promise — await obligatorio
export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    console.log('[DELETE borradores] id:', id);   // log temporal de diagnóstico
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
        .from('autoficha_borradores')
        .delete()
        .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

    const body = await req.json();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('autoficha_borradores')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ borrador: data });
}
