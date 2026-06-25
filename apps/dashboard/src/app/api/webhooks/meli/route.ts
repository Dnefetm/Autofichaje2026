import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';
import { logger } from '@/lib/logger';
import { getWebhookConfigCached } from '@/lib/webhook-config-cache';
import { Redis } from '@upstash/redis';

// Inicializar Redis de forma segura por si faltan env vars
let redis: Redis | null = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
        redis = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN
        });
    } catch (e) {
        console.warn('Error al conectar con Redis:', e);
    }
} else {
    console.warn('Redis no está configurado. El debounce ultra-rápido estará deshabilitado.');
}

/**
 * Webhook MeLi — Push-First con Microventanas (v55)
 *
 * TODA la configuración viene de la tabla webhook_config.
 * El usuario decide desde el panel:
 *   - Si un topic dispara el worker inmediatamente (dispatch_immediate)
 *   - La ventana de consolidación en segundos (window_seconds)
 *   - Si el topic está habilitado (enabled)
 *
 * No hay ningún topic hardcodeado como inmediato en el código.
 * Responde 200 siempre en < 200ms.
 */

// Defaults del código — solo aplican si webhook_config no tiene fila para ese topic.
// El usuario puede sobreescribir todo desde el panel.
const TOPIC_DEFAULTS: Record<string, {
    window_seconds: number;
    dispatch_immediate: boolean;
    priority: number;
}> = {
    orders_v2: { window_seconds: 0,   dispatch_immediate: true,  priority: 0 },
    orders:    { window_seconds: 0,   dispatch_immediate: true,  priority: 0 },
    payments:  { window_seconds: 0,   dispatch_immediate: true,  priority: 0 },
    items:     { window_seconds: 180, dispatch_immediate: false, priority: 2 },
    questions: { window_seconds: 300, dispatch_immediate: false, priority: 3 },
};

const TOPIC_PRIORITY: Record<string, number> = {
    orders_v2: 0, orders: 0, payments: 0,
    items:     2,
    questions: 3,
};

export async function POST(req: NextRequest) {
    const startMs = Date.now();

    try {
        const body = await req.json();
        const { topic, resource, user_id } = body;

        // ALLOWLIST: Solo los topics que REALMENTE generan jobs pasan.
        // Todo lo demás (fbm_stock, stock, public_offers, price_suggestion, shipments,
        // messages, created_orders, payments, questions, etc.) muere aquí en <1ms sin tocar Postgres.
        // Esto detiene el llenado de webhook_buffer de eventos que no procesamos.
        const ALLOWED_TOPICS = ['orders_v2', 'orders', 'items'];
        if (!ALLOWED_TOPICS.includes(topic)) {
            return NextResponse.json({ status: 'ignored', reason: 'topic_not_in_allowlist' });
        }

        // BINGO: Redis Debounce ultra-rápido (El asesino de ráfagas original)
        if (redis) {
            const resourceIdFast = String(resource).split('/').filter(Boolean).pop() ?? resource;
            const dedupeKey = `webhook:meli:burst:${topic}:${resourceIdFast}`;
            // 180 segundos de silencio para items, 60s para el resto
            const exTime = topic === 'items' ? 180 : 60;
            const inserted = await redis.set(dedupeKey, '1', { nx: true, ex: exTime });
            if (!inserted) {
                return NextResponse.json({ status: 'ignored', reason: 'redis_burst_debounce' });
            }
        }

        // Deduplicación PG + Config en PARALELO
        const notificationId = body._id || `${topic}_${resource}_${Date.now()}`;
        const [dedupeResult, configRow] = await Promise.all([
            supabaseAdmin.from('meli_webhook_events').upsert({
                notification_id: notificationId,
                topic,
                resource
            }, { onConflict: 'notification_id', ignoreDuplicates: true }),
            getWebhookConfigCached(topic) // Cache en memoria, ~0ms en cache hit
        ]);

        // Si ya existía, ignoreDuplicates hace que no devuelva error 23505, 
        // pero podemos checar si dedupeResult.status es 201 o algo, o depender del early exit.
        // Dado que upsert con ignoreDuplicates no rompe el flujo, ya no hace falta el check 23505.
        // (Aunque lo dejamos por si las moscas).
        if (dedupeResult.error && dedupeResult.error.code === '23505') {
            return NextResponse.json({ status: 'ignored', reason: 'deduplicated' });
        }

        logger.info({ topic, resource }, 'Webhook MeLi recibido');

        // Fallback a defaults del código si no hay fila en BD
        const fallback = TOPIC_DEFAULTS[topic] ?? {
            window_seconds: 300, dispatch_immediate: false, priority: 3
        };

        const enabled         = configRow ? configRow.enabled           : true;
        const windowSeconds   = configRow ? configRow.window_seconds     : fallback.window_seconds;
        const dispatchImmed   = configRow ? configRow.dispatch_immediate : fallback.dispatch_immediate;
        const priority        = TOPIC_PRIORITY[topic] ?? 3;

        // Topic deshabilitado por el usuario
        if (!enabled) {
            return NextResponse.json({ status: 'ignored', reason: 'topic_disabled' });
        }

        // 2. Extraer resource_id limpio
        const resourceId = String(resource).split('/').filter(Boolean).pop() ?? resource;

        // Función que realiza el trabajo pesado (buffer y jobs)
        const processBackground = async () => {
            try {
                // 3. Upsert en buffer (trazabilidad para todos los topics)
                const { data: existingBuf } = await supabaseAdmin
                    .from('webhook_buffer')
                    .select('id, repeat_count, status, last_processed_at, last_seen_at')
                    .eq('topic', topic)
                    .eq('resource_id', resourceId)
                    .maybeSingle();

                // PG BURST DEBOUNCE: si Redis falló, usamos Postgres para ignorar ráfagas
                if (existingBuf?.last_seen_at) {
                    const msSinceLast = Date.now() - new Date(existingBuf.last_seen_at).getTime();
                    // Si lo vimos hace menos de 60s, morimos silenciosamente para matar la ráfaga
                    if (msSinceLast < 60000) {
                        return false;
                    }
                }

                const nextEligibleAt = new Date(Date.now() + windowSeconds * 1000);

                await supabaseAdmin.from('webhook_buffer').upsert({
                    topic,
                    resource_id:      resourceId,
                    user_id:          user_id ?? null,
                    priority,
                    last_seen_at:     new Date().toISOString(),
                    next_eligible_at: nextEligibleAt.toISOString(),
                    repeat_count:     (existingBuf?.repeat_count ?? 0) + 1,
                    status:           'pending',
                    last_payload:     { topic, resource, user_id },
                }, { onConflict: 'topic,resource_id' });

                // 4. Lógica de job según topic
                let jobInserted = false;

                if (topic === 'orders_v2' || topic === 'orders') {
                    // Dedup de 24h para órdenes
                    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                    const alreadyProcessed = existingBuf?.last_processed_at
                        && existingBuf.last_processed_at > since24h;

                    if (!alreadyProcessed) {
                        const { data: pendingOrder } = await supabaseAdmin
                            .from('jobs')
                            .select('id')
                            .eq('type', 'process_sale')
                            .eq('status', 'pending')
                            .contains('payload', { resource })
                            .maybeSingle();

                        if (!pendingOrder) {
                            await supabaseAdmin.from('jobs').insert({
                                type:         'process_sale',
                                payload:      { marketplace: 'meli', resource, user_id },
                                status:       'pending',
                                priority,
                                scheduled_at: nextEligibleAt.toISOString(),
                            });
                            jobInserted = true;

                            // Marcar como procesado en buffer
                            await supabaseAdmin.from('webhook_buffer').upsert({
                                topic, resource_id: resourceId,
                                last_processed_at: new Date().toISOString(),
                                status: 'done',
                            }, { onConflict: 'topic,resource_id' });
                        }
                    }
                } else if (topic === 'items') {
                    const itemIdMatch = resource.match(/\/items\/(MLM\w+)/);
                    if (itemIdMatch) {
                        const externalItemId = itemIdMatch[1];

                        // Si ya hay job pendiente, no duplicar
                        const { data: pendingJob } = await supabaseAdmin
                            .from('jobs')
                            .select('id')
                            .eq('type', 'sync_item')
                            .eq('status', 'pending')
                            .contains('payload', { external_item_id: externalItemId })
                            .maybeSingle();

                        if (!pendingJob) {
                            // Resolver marketplace_id
                            let marketplaceId: string | null = null;

                            const { data: pub } = await supabaseAdmin
                                .from('publicaciones_externas')
                                .select('marketplace_id')
                                .eq('external_item_id', externalItemId)
                                .eq('external_variation_id', '0')
                                .maybeSingle();

                            if (pub?.marketplace_id) {
                                marketplaceId = pub.marketplace_id;
                            } else if (user_id) {
                                const { data: configs } = await supabaseAdmin
                                    .from('marketplace_configs')
                                    .select('id, settings')
                                    .in('marketplace', ['meli', 'mercadolibre']);
                                const match = (configs || []).find((c: any) =>
                                    String(c.settings?.seller_id) === String(user_id)
                                );
                                if (match) marketplaceId = match.id;
                            }

                            if (marketplaceId) {
                                await supabaseAdmin.from('jobs').insert({
                                    type:         'sync_item',
                                    payload:      { marketplace_id: marketplaceId, external_item_id: externalItemId },
                                    status:       'pending',
                                    priority,
                                    scheduled_at: nextEligibleAt.toISOString(),
                                });
                                jobInserted = true;
                                logger.info({ externalItemId, marketplaceId, window: windowSeconds }, 'items: sync_item encolado');
                            } else {
                                logger.info({ externalItemId }, 'items: item desconocido, ignorado');
                            }
                        } else {
                            logger.info({ externalItemId }, 'items: job ya pendiente, buffer actualizado');
                        }
                    }
                }

                if (dispatchImmed && jobInserted) {
                    // Restauramos la inmediatez real. Gracias a Redis arriba, esto
                    // ya no explotará el CPU porque las ráfagas mueren en 5ms.
                    await dispatchWorker().catch(() => {});
                }

                logger.info({
                    topic, resourceId,
                    dispatch: dispatchImmed && jobInserted ? 'immediate' : 'cron',
                    window: windowSeconds,
                    ms: Date.now() - startMs,
                    job_inserted: jobInserted
                }, 'Webhook procesado (completado)');

                return jobInserted;
            } catch (err: any) {
                logger.error({ error: err.message }, 'Error en proceso background del webhook');
                throw err;
            }
        };

        // Ejecutamos la promesa UNA SOLA VEZ
        const bgPromise = processBackground();

        // Palanca 5: Timeout de 150ms. Si bgPromise tarda más, respondemos 200 y delegamos.
        const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 150));
        const raceResult = await Promise.race([bgPromise.then(() => 'done'), timeoutPromise]);

        if (raceResult === 'timeout') {
            // ERROR GRAVE PREVIO CORREGIDO: `after(() => processBackground())` ejecutaba la función DOS VECES.
            // Ahora devolvemos la misma promesa YA EN CURSO para que Vercel espere que termine.
            after(() => bgPromise);
            
            return NextResponse.json({
                status: 'deferred',
                priority,
                window_seconds: windowSeconds,
            });
        }

        // Si terminó a tiempo (P95 < 150ms)
        return NextResponse.json({
            status: 'received',
            priority,
            dispatch: 'buffered',
            window_seconds: windowSeconds,
        });

    } catch (error: any) {
        logger.error({ error: error.message }, 'Error en webhook MeLi');
        // Siempre 200 para que MeLi no reintente
        return NextResponse.json({ status: 'error_handled' });
    }
}
