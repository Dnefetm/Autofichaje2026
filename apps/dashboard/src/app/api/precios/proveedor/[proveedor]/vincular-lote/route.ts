import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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
    let insertados = 0;

    for (const item of items) {
        const codigoExcel = item.codigo_excel || '';
        const modeloExcel = item.modelo_excel || '';
        const marcaExcel = item.marca_excel || '';

        // Determinar qué buscar para saber si ya existe
        let existingId = null;

        if (codigoExcel !== '') {
            const { data } = await supabaseAdmin
                .from('proveedor_articulos_alias')
                .select('id')
                .eq('proveedor', proveedorDecoded)
                .eq('codigo_excel', codigoExcel)
                .maybeSingle();
            if (data) existingId = data.id;
        } else if (modeloExcel !== '' && marcaExcel !== '') {
            const { data } = await supabaseAdmin
                .from('proveedor_articulos_alias')
                .select('id')
                .eq('proveedor', proveedorDecoded)
                .eq('marca_excel', marcaExcel)
                .eq('modelo_excel', modeloExcel)
                .maybeSingle();
            if (data) existingId = data.id;
        }

        const record = {
            proveedor: proveedorDecoded,
            codigo_excel: codigoExcel === '' ? null : codigoExcel,
            modelo_excel: modeloExcel === '' ? null : modeloExcel,
            marca_excel: marcaExcel === '' ? null : marcaExcel,
            articulo_id: item.articulo_id,
            locked: true,
            locked_at: new Date().toISOString(),
            ultima_vez_visto: new Date().toISOString(),
            estado_proveedor: 'activo'
        };

        if (existingId) {
            await supabaseAdmin
                .from('proveedor_articulos_alias')
                .update(record)
                .eq('id', existingId);
        } else {
            await supabaseAdmin
                .from('proveedor_articulos_alias')
                .insert(record);
        }
        insertados++;
    }

    return NextResponse.json({ ok: true, insertados });
}
