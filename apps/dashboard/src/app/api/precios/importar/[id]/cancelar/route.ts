import { friendlyError } from '@/lib/friendlyError';
/**
 * POST /api/precios/importar/[id]/cancelar
 *
 * Cancela (aborta) una importación atascada o fallida, cambiando su estado a 'cancelado'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function logEvento(sb: any, importacionId: string, estadoPaso: string, mensaje: string) {
  await sb.from('importacion_eventos').insert({
    importacion_id: importacionId,
    estado_paso: estadoPaso,
    mensaje
  });
}

export async function POST(
    _req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await props.params;

        const { data: importacion, error: fetchErr } = await supabaseAdmin
            .from('importaciones_excel')
            .select('estado')
            .eq('id', id)
            .single();

        if (fetchErr || !importacion) {
            return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
        }

        if (importacion.estado === 'completado') {
            return NextResponse.json({ ok: false, error: 'No se puede cancelar una importación que ya está completada' }, { status: 400 });
        }

        const { error: updateErr } = await supabaseAdmin
            .from('importaciones_excel')
            .update({
                estado: 'cancelado',
                ultima_actividad: new Date().toISOString()
            })
            .eq('id', id);

        if (updateErr) {
            return NextResponse.json({ ok: false, error: friendlyError(updateErr) }, { status: 500 });
        }

        await logEvento(supabaseAdmin, id, 'CANCELADO', 'Importación cancelada manualmente desde la interfaz.');

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: friendlyError(err) }, { status: 500 });
    }
}
