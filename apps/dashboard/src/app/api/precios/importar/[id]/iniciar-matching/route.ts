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

    if (imp.estado !== 'completado') {
        return NextResponse.json({ ok: false, error: `Estado actual invalido para iniciar motor: ${imp.estado}. Tienes que consolidar la lista primero.` }, { status: 400 });
    }

    // 1. Obtener la lista de precios oficial consolidada para este proveedor
    const { data: lista, error: listaErr } = await supabaseAdmin
        .from('listas_precios_proveedor')
        .select('id')
        .eq('importacion_id', id)
        .single();

    if (listaErr || !lista) {
        return NextResponse.json({ ok: false, error: 'Lista de proveedor no encontrada o no ha sido consolidada estructuralmente' }, { status: 404 });
    }

    // 2. Revisar si ya existe un trabajo en curso para evitar duplicados
    const { data: existingJob } = await supabaseAdmin
        .from('matching_jobs')
        .select('id, estado')
        .eq('importacion_id', id)
        .in('estado', ['pendiente', 'corriendo'])
        .single();

    if (existingJob) {
        // Ya hay un job activo, solo le damos un "empujón" por si acaso
        await supabaseAdmin.functions.invoke('procesar-matching', { body: {} });
        return NextResponse.json({ ok: true, mensaje: 'El trabajo ya estaba en progreso' }, { status: 200 });
    }

    // 3. Crear un job de matching asociado a la importación
    const { error: insertJobErr } = await supabaseAdmin
        .from('matching_jobs')
        .insert({
            importacion_id: id,
            lista_precios_id: lista.id,
            estado: 'pendiente'
        });

    if (insertJobErr) {
        console.error("Error al encolar matching:", insertJobErr);
        return NextResponse.json({ ok: false, error: 'No se pudo crear trabajo de matching: ' + insertJobErr.message }, { status: 500 });
    }

    // 4. Invocar la Edge Function para que despierte el Worker de Matching
    // Nota: El simple hecho de hacer INSERT con estado='pendiente' dispara el trigger pg_net
    // Hacemos este invoke explícito solo como backup rápido para no depender exclusivamente del trigger en dev
    const runRes = await supabaseAdmin.functions.invoke('procesar-matching', {
        body: { } 
    });

    if (runRes.error) {
        console.error("Backup trigger edge function errored (pg_net trigger will still fire):", runRes.error);
    }

    return NextResponse.json({ ok: true, mensaje: 'Trabajo de matching encolado e iniciado' }, { status: 202 });
}
