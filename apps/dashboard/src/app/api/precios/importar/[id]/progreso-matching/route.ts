import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;

    // Obtener la importación
    const { data: imp, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('estado, total_filas')
        .eq('id', id)
        .single();

    if (fetchErr || !imp) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    // Obtener el job de matching más reciente asociado a esta importación
    const { data: job, error: jobErr } = await supabaseAdmin
        .from('matching_jobs')
        .select('estado, progreso, total, error')
        .eq('importacion_id', id)
        .order('creado_el', { ascending: false })
        .limit(1)
        .single();

    if (jobErr && jobErr.code !== 'PGRST116') { // PGRST116 is not found
        return NextResponse.json({ ok: false, error: jobErr.message }, { status: 500 });
    }

    if (!job) {
        return NextResponse.json({ ok: true, estado_importacion: imp.estado, progreso: 0, total: imp.total_filas, estado_job: null });
    }

    return NextResponse.json({ 
        ok: true, 
        estado_importacion: imp.estado,
        estado_job: job.estado,
        progreso: job.progreso || 0,
        total: imp.total_filas || job.total || 0,
        error: job.error
    }, { status: 200 });
}
