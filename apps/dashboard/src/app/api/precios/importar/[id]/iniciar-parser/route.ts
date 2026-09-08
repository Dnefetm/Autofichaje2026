import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/precios/importar/[id]/iniciar-parser
 *
 * Ahora es SOLO un disparador: valida la importación e invoca la Edge Function
 * de Supabase `procesar-importacion`, que hace el parseo pesado FUERA de Vercel.
 * Así el CPU del parseo no consume el presupuesto de Fluid Active CPU de Vercel.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;

    const { data: imp, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, estado')
        .eq('id', id)
        .single();

    if (fetchErr || !imp) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    if (imp.estado !== 'pendiente_mapeo') {
        return NextResponse.json({ ok: false, error: `Estado actual invalido: ${imp.estado}` }, { status: 400 });
    }

    // El parseo corre en la Edge Function de Supabase (no gasta CPU de Vercel).
    const { error: invErr } = await supabaseAdmin.functions.invoke('procesar-importacion', {
        body: { importacion_id: id },
    });

    if (invErr) {
        return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, estado: 'pendiente_mapeo' });
}
