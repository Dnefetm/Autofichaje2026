import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/catalog/[id]
 * Borra un artículo del catálogo (y sus hijos) para poder re-prepararlo desde cero.
 * Orden: fichas técnicas (cascada a ficha_imagenes/pdfs), luego los hijos sin
 * ON DELETE CASCADE que bloquearían, y al final el artículo (cascada a alias,
 * mapeo, precios, etc.).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!id) return NextResponse.json({ ok: false, error: 'id requerido' }, { status: 400 });

    try {
        // 1) Fichas técnicas del artículo (cascada: ficha_imagenes, ficha_pdfs, ficha_extracciones, ficha_auditoria)
        await supabaseAdmin.from('fichas_tecnicas').delete().eq('articulo_id', id);

        // 2) Hijos sin ON DELETE CASCADE que bloquearían el borrado del artículo
        await supabaseAdmin.from('costos_articulo').delete().eq('articulo_id', id);
        await supabaseAdmin.from('precio_revisiones_manuales').delete().eq('articulo_id', id);
        await supabaseAdmin.from('reservaciones_stock').delete().eq('articulo_id', id);

        // 3) Artículo (cascada: proveedor_articulos_alias, mapeo_publicacion_articulo, marketplace_prices, etc.)
        const { error } = await supabaseAdmin.from('articulos').delete().eq('articulo_id', id);
        if (error) {
            const msg = String(error?.message || '');
            if (msg.includes('orden_items') || (error as any)?.code === '23503') {
                return NextResponse.json(
                    { ok: false, error: 'No se puede borrar: el artículo tiene ventas/órdenes asociadas.' },
                    { status: 409 },
                );
            }
            throw error;
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e?.message || 'Error al borrar el artículo' }, { status: 500 });
    }
}
