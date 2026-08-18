import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function DELETE(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;

    // Verificar que existe
    const { data: imp, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, estado, proveedor')
        .eq('id', id)
        .single();

    if (fetchErr || !imp) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    // Solo se puede eliminar si no está en estado completado/vigente activo
    const estadosEliminables = ['en_revision', 'pendiente_mapeo', 'error', 'cancelado', 'pendiente'];
    if (!estadosEliminables.includes(imp.estado)) {
        return NextResponse.json({
            ok: false,
            error: `No se puede eliminar una importación en estado "${imp.estado}". Solo se eliminan importaciones en revisión, pendientes o con error.`
        }, { status: 400 });
    }

    // Borrar en cascada: costos_articulo → listas_precios_raw_staging → listas_precios_raw → listas_precios_proveedor → importacion
    await supabaseAdmin.from('costos_articulo').delete().eq('importacion_id', id);
    await supabaseAdmin.from('listas_precios_raw_staging').delete().eq('importacion_id', id);
    await supabaseAdmin.from('listas_precios_raw').delete().eq('importacion_id', id);
    await supabaseAdmin.from('listas_precios_proveedor').delete().eq('importacion_id', id);

    const { error: delErr } = await supabaseAdmin
        .from('importaciones_excel')
        .delete()
        .eq('id', id);

    if (delErr) {
        return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
