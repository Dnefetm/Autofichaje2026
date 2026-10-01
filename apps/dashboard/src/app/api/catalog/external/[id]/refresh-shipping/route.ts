import { NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/catalog/external/[id]/refresh-shipping
 *
 * Refresca el costo de envío real de UNA publicación (de SU cuenta), llamando a
 * MeLi GET /users/{seller}/shipping_options/free?item_id=X (igual que el publicador
 * obtiene el envío estimado). Actualiza shipping_cost_monto de esa publicación.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const { data: pub, error } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('marketplace_id, external_item_id')
            .eq('id', id)
            .maybeSingle();

        if (error || !pub || !pub.marketplace_id || !pub.external_item_id) {
            return NextResponse.json({ error: 'Publicación no encontrada' }, { status: 404 });
        }

        const meli = new MeliAdapter();
        await meli.syncShippingCost(pub.marketplace_id, pub.external_item_id);

        const { data: updated } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('shipping_cost_monto')
            .eq('id', id)
            .maybeSingle();

        return NextResponse.json({
            success: true,
            shipping_cost_monto: updated?.shipping_cost_monto ?? null,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error refrescando envío' }, { status: 500 });
    }
}
