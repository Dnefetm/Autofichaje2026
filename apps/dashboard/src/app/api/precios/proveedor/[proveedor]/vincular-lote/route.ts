import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Extend duration for large batches

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ proveedor: string }> }
) {
    const { proveedor } = await props.params;
    const body = await req.json();
    const { items }: {
        items: Array<{
            codigo_excel: string;
            modelo_excel: string;
            marca_excel: string;
            articulo_id: string;
        }>
    } = body;

    if (!items || items.length === 0) {
        return NextResponse.json({ ok: false, error: 'No hay items' }, { status: 400 });
    }

    const proveedorDecoded = decodeURIComponent(proveedor);

    const { error } = await supabaseAdmin.rpc('fn_vincular_lote', {
        p_proveedor: proveedorDecoded,
        p_items: items
    });

    if (error) {
        console.error('Error in fn_vincular_lote:', error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    revalidatePath('/precios', 'layout');
    return NextResponse.json({ ok: true, insertados: items.length });
}

