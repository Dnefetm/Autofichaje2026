import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST   -> "Ignorar" una fila (persistente).
// DELETE -> "Restaurar" una fila ignorada.
export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id: importacionId } = await props.params;
    const { fila_num } = await req.json();

    if (fila_num === undefined || fila_num === null) {
        return NextResponse.json({ ok: false, error: 'Falta fila_num' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
        .from('vinculacion_rechazos')
        .upsert({ importacion_id: importacionId, fila_num }, { onConflict: 'importacion_id,fila_num' });

    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    await rematerializar(importacionId);
    return NextResponse.json({ ok: true });
}

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id: importacionId } = await props.params;
    const { fila_num } = await req.json();

    if (fila_num === undefined || fila_num === null) {
        return NextResponse.json({ ok: false, error: 'Falta fila_num' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
        .from('vinculacion_rechazos')
        .delete()
        .eq('importacion_id', importacionId)
        .eq('fila_num', fila_num);

    if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    await rematerializar(importacionId);
    return NextResponse.json({ ok: true });
}

async function rematerializar(importacionId: string) {
    const { data: imp } = await supabaseAdmin
        .from('importaciones_excel')
        .select('proveedor')
        .eq('id', importacionId)
        .single();
    const proveedor = imp?.proveedor;
    if (!proveedor) return;

    const { error } = await supabaseAdmin.rpc('fn_materializar_vinculacion', {
        p_importacion_id: importacionId,
        p_proveedor: proveedor,
    });
    if (error) console.error('Error re-materializando tras rechazo:', error);
}
