import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas — Lista órdenes con sus items y reservaciones
// Query params:
//   status   — filtrar por status de orden (ej: paid, cancelled)
//   limit    — cuántas filas retornar (default 50, max 200)
//   offset   — paginación (default 0)
//   desde    — ISO date desde la que filtrar (date_created >= desde)
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = req.nextUrl;
        const status   = searchParams.get('status');
        const limit    = Math.min(parseInt(searchParams.get('limit')  || '50'), 200);
        const offset   = parseInt(searchParams.get('offset') || '0');
        const desde    = searchParams.get('desde');

        let query = supabaseAdmin
            .from('ordenes')
            .select(`
                id,
                meli_order_id,
                status,
                date_created,
                date_closed,
                buyer_id,
                total_amount,
                paid_amount,
                currency_id,
                shipping_logistic_type,
                tags,
                marketplace_id,
                orden_items (
                    id,
                    meli_item_id,
                    meli_variation_id,
                    titulo,
                    quantity,
                    unit_price,
                    seller_sku,
                    articulo_id,
                    publicacion_id,
                    reservaciones_stock (
                        id,
                        cantidad,
                        estado
                    )
                )
            `, { count: 'exact' })
            .order('date_created', { ascending: false })
            .range(offset, offset + limit - 1);

        if (status) query = query.eq('status', status);
        if (desde)  query = query.gte('date_created', desde);

        const { data, error, count } = await query;
        if (error) throw error;

        return NextResponse.json({ data, total: count, offset, limit });
    } catch (err: any) {
        console.error('[GET /api/ventas]', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
