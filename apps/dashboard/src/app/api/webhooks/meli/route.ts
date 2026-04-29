import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { logger } from '@/lib/logger';

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

        // Early filtering to prevent CPU exhaustion on Vercel Hobby plan
        // High-volume topics that are currently unused are discarded immediately before DB queries.
        const IGNORED_TOPICS = ['price_suggestion', 'shipments', 'messages', 'created_orders'];
        if (IGNORED_TOPICS.includes(topic)) {
            return NextResponse.json({ status: 'ignored', reason: 'early_filtered_topic' });
        }

        // Deduplication using PostgreSQL UNIQUE constraint
        const notificationId = body._id || `${topic}_${resource}_${Date.now()}`;
        const { error: dedupeError } = await supabaseAdmin.from('meli_webhook_events').insert({
            notification_id: notificationId,
            topic,
            resource
        });

        // '23505' is PostgreSQL unique violation error code
        if (dedupeError && dedupeError.code === '23505') {
            return NextResponse.json({ status: 'ignored', reason: 'deduplicated' });
        }

        logger.info({ topic, resource }, 'Webhook MeLi recibido');

        // 1. Leer configuración desde BD — TODO viene de aquí, nada hardcodeado
        const { data: configRow } = await supabaseAdmin
            .from('webhook_config')
            .select('window_seconds, dispatch_immediate, enabled, priority')
            .eq('topic', topic)
            .maybeSingle();

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
                    .select('id, repeat_count, status, last_processed_at')
                    .eq('topic', topic)
                    .eq('resource_id', resourceId)
                    .maybeSingle();

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

                logger.info({
                    topic, resourceId,
                    dispatch: 'cron',
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

        // Palanca 5: Timeout de 150ms. Si processBackground tarda más, respondemos 200 y lo pasamos a after()
        const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 150));
        const raceResult = await Promise.race([processBackground().then(() => 'done'), timeoutPromise]);

        if (raceResult === 'timeout') {
            // Se agotó el tiempo, delegamos el resto de la ejecución a background (Next.js 15+ after)
            after(() => processBackground());
            
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
