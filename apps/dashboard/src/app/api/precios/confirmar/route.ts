import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
    try {
        const { importacion_id, proveedor, modo, ids } = await req.json();

        if (!importacion_id || !modo) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        let query = supabaseAdmin
            .from('costos_articulo')
            .update({ confirmado_por: 'operador_dashboard', actualizado_el: new Date().toISOString() })
            .eq('importacion_id', importacion_id)
            .in('estado_match', ['match_exacto', 'completado', 'confirmado']);

        if (modo === 'individual' && ids && ids.length > 0) {
            query = query.in('id', ids);
        } else if (modo === 'lote') {
            // Update 200 unconfirmed items
            // Supabase update doesn't support LIMIT directly, so we must subquery
            const { data: batch } = await supabaseAdmin
                .from('costos_articulo')
                .select('id')
                .eq('importacion_id', importacion_id)
                .in('estado_match', ['match_exacto', 'completado', 'confirmado'])
                .is('confirmado_por', null)
                .limit(200);
            
            if (batch && batch.length > 0) {
                query = query.in('id', batch.map(b => b.id));
            } else {
                return NextResponse.json({ success: true, count: 0 });
            }
        } else if (modo === 'todos') {
            // Keep the query as is, updates all
            query = query.is('confirmado_por', null);
        }

        const { data, error } = await query.select('id');

        if (error) throw error;

        return NextResponse.json({ success: true, count: data ? data.length : 0 });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
