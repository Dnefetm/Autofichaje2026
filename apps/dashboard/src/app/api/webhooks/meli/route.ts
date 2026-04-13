import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';
import { logger } from '@/lib/logger';

/**
 * Webhook MeLi — Push-First con Microventanas (v55)
 *
 * Arquitectura:
 *   - P0 (orders/payments): procesamiento inmediato con dispatchWorker()
 *   - P1/P2/P3 (items, questions, etc.): buffer por resource_id, ventana configurable,
 *     el cron safety-net (1 min) recoge los jobs.
 *
 * Configuración de ventanas: tabla webhook_config en BD.
 * Buffer de consolidación: tabla webhook_buffer en BD.
 *
 * El webhook NUNCA hace trabajo pesado en la ruta crítica.
 * Responde 200 en < 200ms siempre.
 */

// Prioridades por topic
const TOPIC_PRIORITY: Record<string, number> = {
    orders_v2: 0,
    orders:    0,
    payments:  0,
    items:     2,
    questions: 3,
};

// Ventanas y configuración por defecto (fallback si webhook_config no tiene la fila)
const TOPIC_DEFAULTS: Record<string, { window_seconds: number; dispatch_immediate: boolean }> = {
    orders_v2: { window_seconds: 0,   dispatch_immediate: true  },
    orders:    { window_seconds: 0,   dispatch_immediate: true  },
    payments:  { window_seconds: 0,   dispatch_immediate: true  },
    items:     { window_seconds: 180, dispatch_immediate: false },
    questions: { window_seconds: 300, dispatch_immediate: false },
};

export async function POST(req: NextRequest) {
    const startMs = Date.now();

    try {
        const body = await req.json();
        const { topic, resource, user_id } = body;

        if (!topic || !resource) {
            return NextResponse.json({ status: 'ignored', reason: 'missing_topic_or_resource' });
        }

        logger.info({ topic, resource }, 'Webhook MeLi recibido');

        // 1. Leer configuración de este topic desde BD (con fallback a defaults)
        const { data: configRow } = await supabaseAdmin
            .from('webhook_config')
            .select('window_seconds, dispatch_immediate, enabled')
            .eq('topic', topic)
            .maybeSingle();

        const cfg = configRow ?? TOPIC_DEFAULTS[topic] ?? { window_seconds: 300, dispatch_immediate: false };

        // Topic deshabilitado por el usuario desde el panel
        if (configRow && !configRow.enabled) {
            return NextResponse.json({ status: 'ignored', reason: 'topic_disabled' });
        }

        const priority = TOPIC_PRIORITY[topic] ?? 3;
        const windowSeconds = cfg.window_seconds ?? 180;
        const dispatchImmediate = cfg.dispatch_immediate ?? false;

        // 2. Extraer resource_id limpio del path (ej: "/orders/1234" → "1234")
        const resourceId = String(resource).split('/').filter(Boolean).pop() ?? resource;

        // ── P0: Órdenes y pagos — procesamiento inmediato ───────────────────────
        if (dispatchImmediate) {
            await handleImmediateEvent(topic, resource, resourceId, user_id, priority);
            logger.info({ topic, resourceId, ms: Date.now() - startMs }, 'P0: job insertado + dispatch');
            return NextResponse.json({ status: 'received', priority: 0, dispatch: 'immediate' });
        }

        // ── P2/P3: Items y metadata — buffer con ventana configurable ───────────
        await handleBufferedEvent(topic, resource, resourceId, user_id, priority, windowSeconds);
        logger.info({ topic, resourceId, ms: Date.now() - startMs }, `P${priority}: buffereado, ventana ${windowSeconds}s`);
        return NextResponse.json({ status: 'received', priority, dispatch: 'buffered', window_seconds: windowSeconds });

    } catch (error: any) {
        logger.error({ error: error.message }, 'Error en webhook MeLi');
        // SIEMPRE responder 200 a MeLi para que no reintente
        return NextResponse.json({ status: 'error_handled' });
    }
}

/**
 * P0 — Eventos inmediatos (órdenes, pagos).
 * Inserta job y despacha worker. Dedup de 24h por resource_id.
 */
async function handleImmediateEvent(
    topic: string, resource: string, resourceId: string,
    userId: string | undefined, priority: number
) {
    // Dedup: mismo resource_id no se reprocesa en 24h
    const dedupeKey = `${topic}:${resourceId}`;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: existing } = await supabaseAdmin
        .from('webhook_buffer')
        .select('id, last_processed_at')
        .eq('topic', topic)
        .eq('resource_id', resourceId)
        .maybeSingle();

    if (existing?.last_processed_at && existing.last_processed_at > since) {
        // Ya procesado en las últimas 24h
        logger.info({ dedupeKey }, 'P0 duplicado ignorado (24h)');
        return;
    }

    // Upsert en buffer (trazabilidad)
    await supabaseAdmin.from('webhook_buffer').upsert({
        topic,
        resource_id: resourceId,
        user_id: userId ?? null,
        priority,
        last_seen_at: new Date().toISOString(),
        last_processed_at: new Date().toISOString(),
        repeat_count: existing ? (await supabaseAdmin
            .from('webhook_buffer')
            .select('repeat_count')
            .eq('topic', topic)
            .eq('resource_id', resourceId)
            .maybeSingle()
        ).data?.repeat_count ?? 1 + 1 : 1,
        status: 'done',
        last_payload: { topic, resource, user_id: userId },
    }, { onConflict: 'topic,resource_id' });

    // Insertar job
    if (topic === 'orders_v2' || topic === 'orders') {
        const { data: jobExists } = await supabaseAdmin
            .from('jobs')
            .select('id')
            .eq('type', 'process_sale')
            .eq('status', 'pending')
            .contains('payload', { resource })
            .maybeSingle();

        if (!jobExists) {
            await supabaseAdmin.from('jobs').insert({
                type: 'process_sale',
                payload: { marketplace: 'meli', resource, user_id: userId },
                status: 'pending',
                priority: 0,
                scheduled_at: new Date().toISOString(),
            });
        }
    }

    await dispatchWorker();
}

/**
 * P2/P3 — Eventos con ventana (items, questions, metadata).
 * Solo actualiza el buffer. NO despacha worker.
 * El cron safety-net (cron-job.org, cada 1 min) recoge los jobs.
 */
async function handleBufferedEvent(
    topic: string, resource: string, resourceId: string,
    userId: string | undefined, priority: number, windowSeconds: number
) {
    const now = new Date();

    // Verificar si ya hay job pendiente para este resource
    const jobType = topic === 'items' ? 'sync_item' : topic;

    // Para items: resolver external_item_id y marketplace_id
    if (topic === 'items') {
        const itemIdMatch = resource.match(/\/items\/(MLM\w+)/);
        if (!itemIdMatch) return;

        const externalItemId = itemIdMatch[1];
        const nextEligibleAt = new Date(now.getTime() + windowSeconds * 1000);

        // Upsert en buffer (consolida múltiples notificaciones del mismo item)
        const { data: existingBuf } = await supabaseAdmin
            .from('webhook_buffer')
            .select('id, repeat_count, status')
            .eq('topic', topic)
            .eq('resource_id', externalItemId)
            .maybeSingle();

        await supabaseAdmin.from('webhook_buffer').upsert({
            topic,
            resource_id: externalItemId,
            user_id: userId ?? null,
            priority,
            last_seen_at: now.toISOString(),
            // next_eligible_at solo se actualiza si no hay job pendiente ya
            next_eligible_at: existingBuf?.status === 'pending'
                ? nextEligibleAt.toISOString()  // extender ventana
                : nextEligibleAt.toISOString(),
            repeat_count: (existingBuf?.repeat_count ?? 0) + 1,
            status: 'pending',
            last_payload: { topic, resource, user_id: userId },
        }, { onConflict: 'topic,resource_id' });

        // Verificar si ya hay job pendiente de sync_item para este item
        const { data: pendingJob } = await supabaseAdmin
            .from('jobs')
            .select('id')
            .eq('type', 'sync_item')
            .eq('status', 'pending')
            .contains('payload', { external_item_id: externalItemId })
            .maybeSingle();

        if (pendingJob) {
            // Ya hay job pendiente — no insertar duplicado
            logger.info({ externalItemId }, 'items: job ya pendiente, solo se actualizó el buffer');
            return;
        }

        // Resolver marketplace_id (primero BD, luego por user_id)
        let marketplaceId: string | null = null;

        const { data: pub } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('marketplace_id')
            .eq('external_item_id', externalItemId)
            .eq('external_variation_id', '0')
            .maybeSingle();

        if (pub?.marketplace_id) {
            marketplaceId = pub.marketplace_id;
        } else if (userId) {
            const { data: configs } = await supabaseAdmin
                .from('marketplace_configs')
                .select('id, settings')
                .in('marketplace', ['meli', 'mercadolibre']);
            const match = (configs || []).find((c: any) =>
                String(c.settings?.seller_id) === String(userId)
            );
            if (match) marketplaceId = match.id;
        }

        if (!marketplaceId) {
            logger.info({ externalItemId }, 'items: item desconocido, ignorado');
            return;
        }

        // Insertar job con scheduled_at = next_eligible_at (el worker lo toma cuando corresponde)
        await supabaseAdmin.from('jobs').insert({
            type: 'sync_item',
            payload: { marketplace_id: marketplaceId, external_item_id: externalItemId },
            status: 'pending',
            priority,
            scheduled_at: nextEligibleAt.toISOString(), // respeta la ventana
        });

        logger.info({ externalItemId, marketplaceId, window: windowSeconds }, 'items: sync_item encolado con ventana');
    }
}
