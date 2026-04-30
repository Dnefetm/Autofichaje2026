import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';

export async function POST(req: Request) {
    try {
        const { proveedor } = await req.json();

        if (!proveedor) {
            return NextResponse.json({ error: 'Missing proveedor' }, { status: 400 });
        }

        // Get all active publications for this provider
        const { data: pubs, error } = await supabaseAdmin
            .from('v_lista_precios_proveedor')
            .select('articulo_id')
            .eq('proveedor', proveedor);

        if (error) throw error;
        if (!pubs || pubs.length === 0) {
            return NextResponse.json({ success: true, enqueued: 0 });
        }

        const batchId = crypto.randomUUID();

        // Prepare queue items
        const queueItems = pubs.map(p => ({
            articulo_id: p.articulo_id,
            estado: 'pendiente'
            // We would also include batch_id if the column exists
        }));

        // Insert into precio_recalc_queue
        const { error: insertError } = await supabaseAdmin
            .from('precio_recalc_queue')
            .insert(queueItems);

        if (insertError) throw insertError;

        return NextResponse.json({ success: true, enqueued: queueItems.length, batch_id: batchId });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
