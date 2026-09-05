import { supabaseAdmin } from '@/lib/supabase';
import { friendlyError } from '@/lib/friendlyError';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Desvincular de VÍNCULO (no de precio): borra el alias manual (locked=true) y
// re-materializa para que el producto de la lista vuelva de "ya_vinculado" a
// "propuestas". No toca el artículo del catálogo ni su precio.
export async function POST(
    req: NextRequest,
    props: { params: Promise<{ proveedor: string }> }
) {
    const { proveedor } = await props.params;
    const proveedorDecoded = decodeURIComponent(proveedor);
    const body = await req.json();
    const { importacion_id, codigo_excel, modelo_excel, marca_excel } = body;

    if (!importacion_id || (!codigo_excel && !(marca_excel && modelo_excel))) {
        return NextResponse.json({ ok: false, error: 'Faltan datos para desvincular' }, { status: 400 });
    }

    // Borra el alias manual (el vínculo). Solo actúa sobre proveedor_articulos_alias.
    let query = supabaseAdmin
        .from('proveedor_articulos_alias')
        .delete()
        .eq('proveedor', proveedorDecoded)
        .eq('locked', true);

    if (codigo_excel) {
        query = query.eq('codigo_excel', codigo_excel);
    } else {
        query = query.eq('marca_excel', marca_excel).eq('modelo_excel', modelo_excel);
    }

    const { error } = await query;
    if (error) {
        return NextResponse.json({ ok: false, error: friendlyError(error) }, { status: 500 });
    }

    // Re-materializar para que la fila vuelva a su categoría automática.
    const { error: matErr } = await supabaseAdmin.rpc('fn_materializar_vinculacion', {
        p_importacion_id: importacion_id,
        p_proveedor: proveedorDecoded,
    });
    if (matErr) {
        console.error('Error re-materializando tras desvincular:', matErr);
    }

    return NextResponse.json({ ok: true });
}
