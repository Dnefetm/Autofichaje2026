import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Aceptar un lote completo de vinculaciones por categoría
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

    // Upsert masivo en proveedor_articulos_alias con locked=true (aprobado manualmente)
    const rows = items.map(item => ({
        proveedor: decodeURIComponent(proveedor),
        codigo_excel: item.codigo_excel || null,
        modelo_excel: item.modelo_excel || null,
        marca_excel: item.marca_excel || null,
        articulo_id: item.articulo_id,
        locked: true,
        locked_at: new Date().toISOString(),
        ultima_vez_visto: new Date().toISOString(),
        estado_proveedor: 'activo'
    }));

    // Insertar en lotes de 100 (para evitar límites de payload)
    let insertados = 0;
    for (let i = 0; i < rows.length; i += 100) {
        const lote = rows.slice(i, i + 100);
        const { error } = await supabaseAdmin
            .from('proveedor_articulos_alias')
            .upsert(lote, { onConflict: 'proveedor,codigo_excel' });
        if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }
        insertados += lote.length;
    }

    return NextResponse.json({ ok: true, insertados });
}
