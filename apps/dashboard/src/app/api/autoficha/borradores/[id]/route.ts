import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// DELETE /api/autoficha/borradores/[id]
// PATCH  /api/autoficha/borradores/[id]  (estado=guardado al completar)

// Usa service_role_key para bypassear RLS — de lo contrario el DELETE
// retorna vacío sin error cuando RLS no tiene política para anon.
function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
        .from('autoficha_borradores')
        .delete()
        .eq('id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
    const body = await req.json();
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
        .from('autoficha_borradores')
        .update({ ...body, updated_at: new Date().toISOString() })
        .eq('id', params.id)
        .select()
        .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ borrador: data });
}
