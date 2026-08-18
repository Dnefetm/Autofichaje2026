import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;

    // Verificar que existe
    const { data: imp, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, estado, proveedor, total_filas')
        .eq('id', id)
        .single();

    if (fetchErr || !imp) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    // Marcar todas las listas anteriores del proveedor como no vigentes
    await supabaseAdmin
        .from('listas_precios_proveedor')
        .update({ vigente: false, fecha_vigor_hasta: new Date().toISOString().split('T')[0] })
        .eq('proveedor', imp.proveedor)
        .neq('importacion_id', id);

    // Marcar esta lista como vigente
    await supabaseAdmin
        .from('listas_precios_proveedor')
        .upsert({
            proveedor: imp.proveedor,
            importacion_id: id,
            vigente: true,
            fecha_vigor_desde: new Date().toISOString().split('T')[0],
            total_filas: imp.total_filas
        }, { onConflict: 'importacion_id' });

    // Marcar la importacion como completada
    const { error: updateErr } = await supabaseAdmin
        .from('importaciones_excel')
        .update({
            estado: 'completado',
            ultima_actividad: new Date().toISOString()
        })
        .eq('id', id);

    if (updateErr) {
        return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, proveedor: imp.proveedor });
}
