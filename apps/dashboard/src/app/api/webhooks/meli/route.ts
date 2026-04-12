import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { Redis } from '@upstash/redis';
import { logger } from '@/lib/logger';
import { dispatchWorker } from '@/lib/dispatch-worker';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { topic, resource, user_id } = body;

        logger.info({ topic, resource }, 'Recibido webhook de Mercado Libre');

        // 2. Procesar órdenes (ventas)
        // Deduplicación de 24h solo para orders: un mismo resource de orden no necesita reprocesarse en el día.
        if (topic === 'orders_v2' || topic === 'orders') {
            const dedupeKey = `webhook:meli:${resource}`;
            const isDuplicate = await redis.set(dedupeKey, 'processed', { nx: true, ex: 86400 });
            if (!isDuplicate) {
                return NextResponse.json({ status: 'ignored', reason: 'duplicate' });
            }
            // Encolar job de alta prioridad para procesar la venta
            await supabase.from('jobs').insert({
                type: 'process_sale',
                payload: { marketplace: 'meli', resource, user_id },
                status: 'pending',
                scheduled_at: new Date().toISOString()
            });
            await dispatchWorker(); // V31: trigger worker on-demand
        }

        // 3. Procesar cambios en publicaciones (items)
        // MeLi envía este topic cuando cambia precio, stock, logistic_type, status, etc.
        // Dedup de 5 min — suficiente para absorber ráfagas sin bloquear cambios posteriores.
        if (topic === 'items') {
            const itemIdMatch = resource.match(/\/items\/(MLM\w+)/);
            if (itemIdMatch) {
                const externalItemId = itemIdMatch[1];
                const dedupeItemKey = `webhook:meli:items:${externalItemId}`;
                // redis.set nx devuelve 'OK' si insertó (NO es duplicado), null si ya existía (ES duplicado)
                const inserted = await redis.set(dedupeItemKey, '1', { nx: true, ex: 300 });
                if (!inserted) {
                    // Ya procesado en los últimos 5 min — ignorar
                    return NextResponse.json({ status: 'ignored', reason: 'duplicate_item_5min' });
                }
                // Resolver a qué cuenta pertenece (la BD ya lo sabe — no hace falta llamar a MeLi)
                const { data: pub } = await supabase
                    .from('publicaciones_externas')
                    .select('marketplace_id')
                    .eq('external_item_id', externalItemId)
                    .eq('external_variation_id', '0')
                    .maybeSingle();

                if (pub?.marketplace_id) {
                    await supabase.from('jobs').insert({
                        type: 'sync_item',
                        payload: { marketplace_id: pub.marketplace_id, external_item_id: externalItemId },
                        status: 'pending',
                        priority: 2,
                    });
                    await dispatchWorker();
                    logger.info({ externalItemId, marketplace_id: pub.marketplace_id }, 'Webhook items: sync_item encolado');
                } else {
                    // B4: Item no conocido en BD — intentar resolver cuenta por user_id del webhook.
                    // Cubre items creados directamente en MeLi fuera del gestor.
                    if (user_id) {
                        const { data: configs } = await supabase
                            .from('marketplace_configs')
                            .select('id, settings')
                            .in('marketplace', ['meli', 'mercadolibre']);
                        const matchedConfig = (configs || []).find((c: any) =>
                            String(c.settings?.seller_id) === String(user_id)
                        );
                        if (matchedConfig) {
                            await supabase.from('jobs').insert({
                                type: 'sync_item',
                                payload: { marketplace_id: matchedConfig.id, external_item_id: externalItemId },
                                status: 'pending',
                                priority: 2,
                            });
                            await dispatchWorker();
                            logger.info({ externalItemId, marketplace_id: matchedConfig.id }, 'Webhook items: item desconocido — sync_item encolado por user_id');
                        } else {
                            logger.info({ externalItemId, user_id }, 'Webhook items: item no encontrado en BD ni en configs, ignorado');
                        }
                    } else {
                        logger.info({ externalItemId }, 'Webhook items: item no encontrado en BD, ignorado');
                    }
                }
            }
        }

        return NextResponse.json({ status: 'received' });
    } catch (error: any) {
        console.error('Error en webhook MeLi:', error);
        return NextResponse.json({ status: 'error', message: error.message }, { status: 500 });
    }
}
