import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request, props: { params: Promise<{ proveedor: string }> }) {
    try {
        const { decisiones, importacion_id } = await req.json();

        if (!decisiones || !importacion_id) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        let updatedCount = 0;

        // Group IDs by decision
        const byDecision: Record<string, string[]> = {};
        for (const articulo_id in decisiones) {
            const decision = decisiones[articulo_id];
            if (!byDecision[decision]) byDecision[decision] = [];
            byDecision[decision].push(articulo_id);
        }

        for (const decision in byDecision) {
            const ids = byDecision[decision];
            if (ids.length > 0) {
                // Batch update
                const { data, error } = await supabaseAdmin
                    .from('costos_articulo')
                    .update({ 
                        confirmado_por: decision, 
                        actualizado_el: new Date().toISOString() 
                    })
                    .eq('importacion_id', importacion_id)
                    .in('articulo_id', ids)
                    .eq('estado_match', 'completado')
                    .select('id');

                if (error) throw error;
                updatedCount += data ? data.length : 0;
            }
        }

        return NextResponse.json({ success: true, count: updatedCount });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
