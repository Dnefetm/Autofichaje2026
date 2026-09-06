import { friendlyError } from '@/lib/friendlyError';
/**
 * POST /api/precios/importar/[id]/iniciar-matching
 *
 * 1. Setea el estado de la importación a 'mapeando'.
 * 2. Esto dispara el trigger en base de datos que a su vez llama a la Edge Function 'procesar-importacion'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;

    const { data: imp, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('estado')
        .eq('id', id)
        .single();

    if (fetchErr || !imp) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    if (imp.estado !== 'completado' && imp.estado !== 'mapeando') {
        return NextResponse.json({ ok: false, error: `Estado actual invalido para iniciar motor: ${imp.estado}. Tienes que consolidar la lista primero.` }, { status: 400 });
    }

    // 1. Revisar si ya existe un trabajo en curso para evitar duplicados
    const { data: existingJob } = await supabaseAdmin
        .from('matching_jobs')
        .select('id, estado')
        .eq('importacion_id', id)
        .in('estado', ['pendiente', 'corriendo'])
        .single();

    if (existingJob) {
        // Ya hay un job activo o pendiente, dejamos que la Edge Function continúe o termine por pg_net.
        // Si se quedó 'colgado', podemos reactivarlo pasándolo a pendiente.
        if (existingJob.estado === 'pendiente' || existingJob.estado === 'corriendo') {
            await supabaseAdmin.from('matching_jobs').update({ estado: 'pendiente' }).eq('id', existingJob.id);
        }
        return NextResponse.json({ ok: true, mensaje: 'El trabajo ya estaba en progreso, se ha reenviado la instrucción al Edge Worker' }, { status: 200 });
    }

    if (imp.estado === 'completado') {
        const { error: updateImpErr } = await supabaseAdmin
            .from('importaciones_excel')
            .update({ estado: 'mapeando' })
            .eq('id', id);

        if (updateImpErr) {
            console.error("Error al actualizar estado a mapeando:", updateImpErr);
            return NextResponse.json({ ok: false, error: 'No se pudo actualizar estado de importación' }, { status: 500 });
        }
    }

    // 2. Obtener el ID de la lista de precios creada
    const { data: lista, error: listaErr } = await supabaseAdmin
        .from('listas_precios_proveedor')
        .select('id')
        .eq('importacion_id', id)
        .single();

    if (listaErr || !lista) {
        return NextResponse.json({ ok: false, error: 'No se encontró la lista de precios consolidada para esta importación.' }, { status: 400 });
    }

    const { error: insertJobErr } = await supabaseAdmin
        .from('matching_jobs')
        .insert({
            importacion_id: id,
            lista_precios_id: lista.id,
            estado: 'pendiente'
        });

    if (insertJobErr) {
        console.error("Error al encolar matching:", insertJobErr);
        return NextResponse.json({ ok: false, error: friendlyError(insertJobErr) }, { status: 500 });
    }

    // 4. El proceso de matching se disparará automáticamente vía pg_net (Database Trigger)
    // al haber insertado el job con estado='pendiente'.
    // Esto asegura que el frontend reciba el 202 inmediatamente y comience el polling.
    
    return NextResponse.json({ ok: true, mensaje: 'Trabajo de matching encolado e iniciado' }, { status: 202 });
}
