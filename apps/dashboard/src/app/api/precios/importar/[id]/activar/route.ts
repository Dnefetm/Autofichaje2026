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

    // 1. Desactivar todas las listas vigentes anteriores del mismo proveedor
    await supabaseAdmin
        .from('listas_precios_proveedor')
        .update({
            vigente: false,
            fecha_vigor_hasta: new Date().toISOString().split('T')[0]
        })
        .eq('proveedor', imp.proveedor)
        .eq('vigente', true);

    // 2. Verificar si ya existe un registro para esta importacion
    const { data: existing } = await supabaseAdmin
        .from('listas_precios_proveedor')
        .select('id')
        .eq('importacion_id', id)
        .single();

    if (existing) {
        // Actualizar el existente
        await supabaseAdmin
            .from('listas_precios_proveedor')
            .update({
                vigente: true,
                fecha_vigor_desde: new Date().toISOString().split('T')[0],
                fecha_vigor_hasta: null
            })
            .eq('importacion_id', id);
    } else {
        // Crear nuevo registro
        const { error: insertErr } = await supabaseAdmin
            .from('listas_precios_proveedor')
            .insert({
                proveedor: imp.proveedor,
                importacion_id: id,
                vigente: true,
                fecha_vigor_desde: new Date().toISOString().split('T')[0],
                total_filas: imp.total_filas || 0
            });

        if (insertErr) {
            return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
        }
    }

    // 3. Marcar la importacion como completada
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
