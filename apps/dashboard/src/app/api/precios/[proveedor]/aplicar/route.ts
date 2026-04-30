import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request, props: { params: Promise<{ proveedor: string }> }) {
    try {
        const { importacion_id } = await req.json();

        if (!importacion_id) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        // 1. Mark existing costs as no longer vigente if they have a confirmed new cost
        // 2. Set confirmed new costs to vigente=true, estado_match='aplicado'
        // Since Supabase RPC is best for complex transactions, we can simulate or use basic updates.

        // Flip confirmed items to vigente
        const { error: err1 } = await supabaseAdmin
            .from('costos_articulo')
            .update({ vigente: true, estado_match: 'aplicado' })
            .eq('importacion_id', importacion_id)
            .in('confirmado_por', ['aprobado', 'añadir']);

        if (err1) throw err1;

        // Mark importacion as completada
        const { error: err2 } = await supabaseAdmin
            .from('importaciones_precios')
            .update({ estado: 'completado', completado_el: new Date().toISOString() })
            .eq('id', importacion_id);

        if (err2) throw err2;

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
