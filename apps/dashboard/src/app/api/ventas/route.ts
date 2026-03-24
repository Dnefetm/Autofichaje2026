import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas — Lista órdenes con items, reservaciones y nombre de tienda
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
                shipping_id,
                shipping_logistic_type,
                tags,
                marketplace_id,
                buying_mode,
                pack_id,
                raw_json,
                marketplace_configs!ordenes_marketplace_id_fkey (
                    id,
                    settings
                ),
                orden_items (
                    id,
                    meli_item_id,
                    meli_variation_id,
                    titulo,
                    quantity,
                    unit_price,
                    full_unit_price,
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
        if (desde) query = query.gte('date_created', desde);

        const { data, error, count } = await query;
        if (error) throw error;

        // Post-process: flatten store name and extract variation attributes from raw_json
        const enriched = (data || []).map((orden: any) => {
            const storeName = orden.marketplace_configs?.settings?.store_name || 'Sin tienda';
            
            // Extract variation_attributes from raw_json order_items
            const rawItems = orden.raw_json?.order_items || [];
            const itemsWithVariants = orden.orden_items.map((item: any) => {
                const rawMatch = rawItems.find((ri: any) => 
                    ri.item?.id === item.meli_item_id
                );
                const variationAttrs = rawMatch?.item?.variation_attributes || [];
                return { ...item, variation_attributes: variationAttrs };
            });

            // Extract shipping status from tags
            const tags = orden.tags || [];
            let shipping_status = 'pending';
            if (tags.includes('delivered')) shipping_status = 'delivered';
            else if (tags.includes('shipped')) shipping_status = 'shipped';
            else if (tags.includes('not_delivered')) shipping_status = 'not_delivered';

            // Buyer info from raw_json
            const buyer = orden.raw_json?.buyer || {};

            return {
                id: orden.id,
                meli_order_id: orden.meli_order_id,
                status: orden.status,
                date_created: orden.date_created,
                date_closed: orden.date_closed,
                buyer_id: orden.buyer_id,
                buyer_nickname: buyer.nickname || null,
                buyer_first_name: buyer.first_name || null,
                buyer_last_name: buyer.last_name || null,
                total_amount: orden.total_amount,
                paid_amount: orden.paid_amount,
                currency_id: orden.currency_id,
                shipping_id: orden.shipping_id,
                shipping_logistic_type: orden.shipping_logistic_type,
                shipping_status,
                tags: orden.tags,
                marketplace_id: orden.marketplace_id,
                buying_mode: orden.buying_mode,
                pack_id: orden.pack_id,
                store_name: storeName,
                orden_items: itemsWithVariants,
            };
        });

        return NextResponse.json({ data: enriched, total: count, offset, limit });
    } catch (err: any) {
        console.error('[GET /api/ventas]', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
