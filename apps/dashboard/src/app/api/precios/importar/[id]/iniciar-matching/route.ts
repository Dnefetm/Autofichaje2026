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

    if (imp.estado !== 'pendiente_mapeo') {
        return NextResponse.json({ ok: false, error: `Estado actual invalido: ${imp.estado}` }, { status: 400 });
    }

    const { error: updateErr } = await supabaseAdmin
        .from('importaciones_excel')
        .update({
            estado: 'mapeando',
            ultima_actividad: new Date().toISOString(),
        })
        .eq('id', id);

    // Bypass pg_net: Disparar la Edge Function explícitamente y esperar su respuesta.
    // Al awaitearlo, Vercel no mata el proceso prematuramente, asegurando que Deno corra.
    const runRes = await supabaseAdmin.functions.invoke('procesar-importacion', {
        body: { importacion_id: id }
    });

    if (runRes.error) {
        console.error("Error from Edge Function:", runRes.error);
        return NextResponse.json({ ok: false, error: "Edge Function Invoke Failed: " + (runRes.error.message || runRes.error) }, { status: 500 });
    }

    return NextResponse.json({ ok: true, estado: 'mapeando' }, { status: 202 });
}
