import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { topic, resource, user_id } = body;

        logger.info({ topic, resource }, 'Recibido webhook de Mercado Libre');

        // 1. Deduplicación con Redis (evitar procesar el mismo recurso dos veces en 24h)
        const dedupeKey = `webhook:meli:${resource}`;
        const isDuplicate = await redis.set(dedupeKey, 'processed', { nx: true, ex: 86400 });

        if (!isDuplicate) {
            return NextResponse.json({ status: 'ignored', reason: 'duplicate' });
        }

        // 2. Procesar solo órdenes (ventas)
        if (topic === 'orders_v2' || topic === 'orders') {
            // Encolar job de alta prioridad para procesar la venta
            await supabase.from('jobs').insert({
                type: 'process_sale',
                payload: { marketplace: 'meli', resource, user_id },
                status: 'pending',
                scheduled_at: new Date().toISOString()
            });
        }

        return NextResponse.json({ status: 'received' });
    } catch (error: any) {
        console.error('Error en webhook MeLi:', error);
        return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
    }
}
