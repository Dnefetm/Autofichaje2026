import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
    try {
        const { data: queue, error: qErr } = await supabaseAdmin
            .from('ml_publicacion_sync_queue')
            .select('id, articulo_id')
            .eq('estado', 'pendiente')
            .order('creado_el', { ascending: true })
            .limit(50);

        if (qErr) throw qErr;

        if (!queue || queue.length === 0) {
            return NextResponse.json({ status: 'empty' });
        }

        for (const item of queue) {
            const { data: price } = await supabaseAdmin
                .from('precios_publicados')
                .select('precio')
                .eq('articulo_id', item.articulo_id)
                .eq('canal', 'mercadolibre')
                .single();

            if (price) {
                // TODO: Call ML API here. For now we emulate success
                await supabaseAdmin
                    .from('ml_publicacion_sync_queue')
                    .update({ estado: 'completado', procesado_el: new Date().toISOString() })
                    .eq('id', item.id);
            } else {
                await supabaseAdmin
                    .from('ml_publicacion_sync_queue')
                    .update({ estado: 'error', error_log: 'Precio no encontrado', intentos: 1 })
                    .eq('id', item.id);
            }
        }

        return NextResponse.json({ success: true, processed: queue.length });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
