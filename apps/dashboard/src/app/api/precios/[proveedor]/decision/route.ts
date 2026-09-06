import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request, props: { params: Promise<{ proveedor: string }> }) {
    try {
        const { sku, accion, importacion_id } = await req.json();

        if (!sku || !accion || !importacion_id) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        // We use confirmado_por to store the decision in the staging row
        const decisionText = accion; 

        // If 'descontinuar' or 'mantener', the row might not exist in current import, so we would need a different handling,
        // but for now we update matching rows.
        
        let query = supabaseAdmin
            .from('costos_articulo')
            .update({ 
                confirmado_por: decisionText, 
                actualizado_el: new Date().toISOString() 
            })
            .eq('importacion_id', importacion_id)
            .eq('articulo_id', sku) // Assuming sku maps to articulo_id
            .eq('estado_match', 'completado');

        const { data, error } = await query.select('id');

        if (error) throw error;

        return NextResponse.json({ success: true, count: data ? data.length : 0 });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
