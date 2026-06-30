// =============================================================================
// WORKER OFICIAL Y UNICO (Vercel). Esta es la fuente de verdad para los jobs.
// El worker standalone de Render/Docker (apps/worker) fue RETIRADO y NO se
// reactivara. Ver apps/worker/DEPRECATED.md. Toda la logica de jobs vive aqui.
// =============================================================================
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { MeliTokenManager } from '@gestor/adapters/meli-tokens';
import { SKU_Service } from '@gestor/shared/sku-service';
import { AutomationManager } from '@gestor/sync/automations';
import { runReconciliation } from '@gestor/sync/reconciliation';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby permite hasta 60s

const BATCH_SIZE = 10; // Subido de 3 a 10: cada invocación procesa ~6s/3jobs; con 10 jobs ~20s, holgado dentro del corte de 25s y maxDuration 60s

/**
 * Worker Cron Endpoint — Reemplaza el polling de Render.
 * Invocado cada 1 minuto por cron-job.org.
 *
 * Seguridad: requiere header Authorization: Bearer <CRON_SECRET>
 * Concurrencia: claim_jobs RPC usa FOR UPDATE SKIP LOCKED — seguro ante invocaciones paralelas.
 */
export async function GET(req: NextRequest) {
    // 1. Verificar secreto
    const authHeader = req.headers.get('authorization');
    const expectedSecret = process.env.CRON_SECRET;

    if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results: any = {
        timestamp: new Date().toISOString(),
        ttlCleaned: 0,
        tokensRefreshed: false,
        jobsProcessed: 0,
        jobResults: [] as any[],
        errors: [] as string[],
    };

    try {
        const now = new Date();
        const currentMinute = now.getMinutes();
        const currentHour = now.getUTCHours();

        // PASO 0: Query ultra-barata — ¿hay trabajo pendiente?
        // Esta es la UNICA query que corre en cada invocación.
        // Si no hay jobs, salimos de inmediato sin tocar tokens, zombies ni TTL.
        const { count } = await supabaseAdmin
            .from('jobs')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        const isMaintenanceWindow = (currentMinute % 5 === 0); // Solo cada 5 min
        const isReconciliationHour = (currentHour % 6 === 0 && currentMinute < 2);
        const isCatalogHour = (currentHour % 8 === 0 && currentMinute < 2);

        // Si no hay jobs Y no es ventana de mantenimiento, salir INMEDIATAMENTE
        if (count === 0 && !isMaintenanceWindow && !isReconciliationHour && !isCatalogHour) {
            return NextResponse.json({ ...results, skipped: true, reason: 'no_jobs', ms: Date.now() - now.getTime() });
        }

        // HOUSEKEEPING: Solo cada 5 minutos para reducir CPU idle
        if (isMaintenanceWindow) {
            // Token refresh
            try {
                await MeliTokenManager.refreshExpiringTokens();
                results.tokensRefreshed = true;
            } catch (tokenErr: any) {
                results.errors.push(`Token refresh failed: ${tokenErr.message}`);
            }

            // TTL Cleanup — Borrar jobs viejos (>7 días) con status terminal
            const { count: cleanedCount } = await supabaseAdmin
                .from('jobs')
                .delete({ count: 'exact' })
                .in('status', ['failed', 'completed'])
                .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
            results.ttlCleaned = cleanedCount || 0;

            // Reaper de zombis
            const { data: zombieData } = await supabaseAdmin.rpc('release_zombie_jobs');
            if (zombieData && zombieData > 0) {
                logger.info({ zombiesReleased: zombieData }, 'Reaper: jobs zombi liberados');
            }
        }

        // Si no hay jobs pero estamos en ventana de mantenimiento/reconciliación,
        // el housekeeping ya corrió arriba. Solo seguimos si hay reconciliación o catálogo.
        if (count === 0 && !isReconciliationHour && !isCatalogHour) {
            return NextResponse.json({ ...results, skipped: true, reason: 'no_jobs_maintenance_done' });
        }

        // 4. Claim y procesar batch de jobs
        const { data: jobs, error: claimError } = await supabaseAdmin.rpc('claim_jobs', {
            batch_size_limit: BATCH_SIZE
        });

        if (claimError) {
            results.errors.push(`claim_jobs RPC error: ${claimError.message}`);
            return NextResponse.json(results);
        }

        if (!jobs || jobs.length === 0) {
            return NextResponse.json(results);
        }

        // Procesar jobs SECUENCIALMENTE con delay entre cada uno
        const meliAdapter = new MeliAdapter();
        const startTimeMs = Date.now();
        
        for (const job of jobs) {
            // PROTECCIÓN CONTRA TIMEOUT DE VERCEL (60s)
            // Si nos acercamos a los 50 segundos, cortamos el batch limpiamente
            if (Date.now() - startTimeMs > 25000) {
                results.errors.push('Cron timeout approaching, aborting batch early to prevent zombie jobs');
                break;
            }

            try {
                await processOneJob(job, meliAdapter);
                results.jobResults.push({ id: job.id, type: job.type, status: 'ok' });
            } catch (err: any) {
                results.jobResults.push({ id: job.id, type: job.type, status: 'error', error: err.message });
            }
            // 1 segundo de respiro entre jobs para no saturar MeLi pero terminar a tiempo
            await new Promise(r => setTimeout(r, 1000));
        }
        results.jobsProcessed = jobs.length;

        // 5. Reconciliación periódica (~cada 6h)
        if (isReconciliationHour) {
            try {
                await runReconciliation();
                (results as any).reconciliation = 'executed';
            } catch (reconErr: any) {
                results.errors.push(`Reconciliation failed: ${reconErr.message}`);
            }
        }

        if (isCatalogHour) {
            try {
                const { data: cuentas } = await supabaseAdmin
                    .from('marketplace_configs')
                    .select('id')
                    .in('marketplace', ['meli', 'mercadolibre']);
                for (const cuenta of (cuentas || [])) {
                    const { data: existing } = await supabaseAdmin
                        .from('jobs')
                        .select('id')
                        .eq('type', 'sync_account_catalog')
                        .eq('status', 'pending')
                        .contains('payload', { marketplace_id: cuenta.id })
                        .maybeSingle();
                    if (!existing) {
                        await supabaseAdmin.from('jobs').insert({
                            type: 'sync_account_catalog',
                            payload: { marketplace_id: cuenta.id },
                            status: 'pending',
                            priority: 10,
                        });
                    }
                }
                (results as any).catalog_sync_queued = true;
            } catch (catalogErr: any) {
                results.errors.push(`sync_account_catalog hook failed: ${catalogErr.message}`);
            }
        }
    } catch (err: any) {
        results.errors.push(`Fatal: ${err.message}`);
    }

    // No encadenar ejecuciones — el cron cada 1 min recoge el trabajo restante.\n    // Encadenar amplificaba el CPU innecesariamente.

    return NextResponse.json(results);
}

// ========================================
// Procesamiento de un solo job
// ========================================
async function processOneJob(job: any, meli: MeliAdapter) {
    // Protección anti-zombis
    const maxAttempts = job.max_attempts || 10;
    if ((job.attempts || 0) >= maxAttempts) {
        await supabaseAdmin.from('jobs').update({
            status: 'failed',
            error_log: `Zombie killed: attempts ${job.attempts} >= max_attempts ${maxAttempts}`
        }).eq('id', job.id);
        return;
    }

    try {
        switch (job.type) {
            case 'sync_stock':
                await handleSyncStock(job, meli);
                if (job.payload.sku && job.payload.newStock !== undefined) {
                    await AutomationManager.evaluateStockRules(job.payload.sku, job.payload.newStock);
                }
                break;
            case 'sync_price':
                await handleSyncPrice(job, meli);
                break;
            case 'sync_stock_mapped':
                await handleSyncStockMapped(job, meli);
                break;
            case 'pause_listing':
                await meli.pauseListing(job.payload.marketplace_id, job.payload.external_item_id);
                break;
            case 'activate_listing':
                await meli.activateListing(job.payload.marketplace_id, job.payload.external_item_id);
                break;
            case 'sync_item':
                await meli.syncCatalogItem(job.payload.marketplace_id, job.payload.external_item_id);
                break;
            case 'sync_account_catalog': {
                const accountId = job.payload.marketplace_id;
                const itemIds = await meli.getAccountItems(accountId);
                console.log(`[sync_account_catalog] Syncing ${itemIds.length} items for account ${accountId} via multiGET batch`);
                // syncCatalogBatchFast: multiGET de 20 IDs en paralelo (~5s para 500 items)
                // Incluye detección de transición fulfillment→otro (portada en Fase 0A)
                // ANTES: loop N×syncCatalogItem + 1s delay → N+N segundos → timeout a >55 items
                const accessToken = await (meli as any).getAccessToken(accountId);
                await meli.syncCatalogBatchFast(accountId, accessToken, itemIds);
                // Post-step: detectar items que MeLi cerró sin pasar por el sync (no aparecen en getAccountItems)
                const reconcile = await meli.reconcileClosedItems(accountId);
                if (reconcile.updated > 0) {
                    console.log(`[sync_account_catalog] reconcileClosedItems: ${reconcile.checked} chequeados, ${reconcile.updated} actualizados`);
                }
                break;
            }

            case 'process_sale':
                await handleProcessSale(job, meli);
                break;
            default:
                throw new Error(`Tipo de job no soportado: ${job.type}`);
        }

        // Marcar completado
        await supabaseAdmin.from('jobs').update({
            status: 'completed',
            processed_at: new Date().toISOString()
        }).eq('id', job.id);
    } catch (error: any) {
        const errMessage = (error.message || JSON.stringify(error)).toLowerCase();

        const isAuthError = errMessage.includes('403') || errMessage.includes('forbidden') ||
            errMessage.includes('not authorized') || errMessage.includes('token expirado') ||
            errMessage.includes('no se pudo renovar');

        if (isAuthError) {
            await supabaseAdmin.from('jobs').update({
                status: 'failed',
                attempts: (job.attempts || 0) + 1,
                processed_at: new Date().toISOString(),
                error_log: `AUTH ERROR (requiere re-autenticación en /settings): ${error.message}`
            }).eq('id', job.id);
            return;
        }

        const isNotModifiable = errMessage.includes('not_modifiable') || errMessage.includes('not modifiable');
        if (isNotModifiable) {
            await supabaseAdmin.from('jobs').update({
                status: 'failed',
                attempts: (job.attempts || 0) + 1,
                processed_at: new Date().toISOString(),
                error_log: `ITEM NO MODIFICABLE (fulfillment/catálogo): ${error.message}`
            }).eq('id', job.id);
            return;
        }

        const isRateLimit = errMessage.includes('rate limit') || errMessage.includes('too_many_requests') ||
            errMessage.includes('429') || errMessage.includes('too many requests');

        if (isRateLimit) {
            const attempts = (job.attempts || 0) + 1;
            const maxRateLimitRetries = 10;
            if (attempts >= maxRateLimitRetries) {
                await supabaseAdmin.from('jobs').update({
                    status: 'failed', attempts,
                    processed_at: new Date().toISOString(),
                    error_log: `Rate Limit persistente tras ${attempts} intentos. Abortado.`
                }).eq('id', job.id);
                return;
            }
            const backoffMs = Math.min(attempts * 2 * 60 * 1000, 15 * 60 * 1000);
            await supabaseAdmin.from('jobs').update({
                status: 'pending', attempts,
                processed_at: new Date().toISOString(),
                scheduled_at: new Date(Date.now() + backoffMs).toISOString(),
                error_log: `Rate Limit. Reintento ${attempts}/${maxRateLimitRetries} en ${Math.round(backoffMs/60000)}min.`
            }).eq('id', job.id);
            return;
        }

        // Fallo normal con retry exponencial
        const nextAttempt = (job.attempts || 0) + 1;
        const isFinal = nextAttempt >= (job.max_attempts || 5);
        await supabaseAdmin.from('jobs').update({
            status: isFinal ? 'failed' : 'pending',
            attempts: nextAttempt,
            processed_at: new Date().toISOString(),
            error_log: error.message || errMessage,
            scheduled_at: new Date(Date.now() + Math.pow(2, nextAttempt) * 1000).toISOString()
        }).eq('id', job.id);

        if (isFinal) {
            try {
                await supabaseAdmin.from('system_alerts').insert({
                    level: 'warning', type: 'job_dlq',
                    message: `Job ${job.id} (${job.type}) fracasó tras ${nextAttempt} intentos.`,
                    metadata: { job_id: job.id, final_error: error.message }
                });
            } catch (_) { /* No fallar si system_alerts no existe */ }
        }
        throw error;
    }
}

// ========================================
// Handlers
// ========================================
async function handleSyncStock(job: any, meli: MeliAdapter) {
    const { sku } = job.payload;
    const availableStock = await SKU_Service.calculateAvailableStock(sku);

    const { data: mappings } = await supabaseAdmin
        .from('mapeo_publicacion_articulo')
        .select(`
            publicacion_id, cantidad_requerida,
            publicaciones_externas!inner (id, marketplace_id, external_item_id, es_fuente_stock, status_externo, sync_disabled, logistic_type)
        `)
        .eq('articulo_id', sku);

    if (!mappings || mappings.length === 0) return;

    const fuentesStock = mappings.filter((m: any) => m.publicaciones_externas);
    if (fuentesStock.length === 0) return;

    const failedVitrinas: string[] = [];
    let successCount = 0;

    for (const mapping of fuentesStock) {
        const pub = mapping.publicaciones_externas as any;
        try {
            if (pub.sync_disabled === true) { successCount++; continue; }
            if (pub.logistic_type === 'fulfillment') { successCount++; continue; }

            const { data: allComponents } = await supabaseAdmin
                .from('mapeo_publicacion_articulo')
                .select('articulo_id, cantidad_requerida')
                .eq('publicacion_id', pub.id);

            let maxKits = availableStock;
            if (allComponents && allComponents.length > 0) {
                maxKits = 999999;
                for (const comp of allComponents) {
                    const compStock = await SKU_Service.calculateAvailableStock(comp.articulo_id);
                    maxKits = Math.min(maxKits, Math.floor(compStock / comp.cantidad_requerida));
                }
            }
            const finalStock = Math.max(0, maxKits);

            const results = await meli.updateStock(pub.marketplace_id, [{ itemId: pub.external_item_id, quantity: finalStock }]);
            const errors = results.filter((r: any) => r.status === 'error');
            if (errors.length > 0) {
                const firstError = errors[0].error;
                throw new Error(`MeLi API: ${typeof firstError === 'object' ? JSON.stringify(firstError) : firstError}`);
            }

            const updateData: any = { stock_publicado: finalStock, actualizado_el: new Date().toISOString() };
            if (finalStock > 0 && pub.status_externo === 'paused') {
                try { await meli.activateListing(pub.marketplace_id, pub.external_item_id); updateData.status_externo = 'active'; } catch (_) {}
            }
            if (finalStock === 0 && pub.status_externo === 'active') {
                try { await meli.pauseListing(pub.marketplace_id, pub.external_item_id); updateData.status_externo = 'paused'; } catch (_) {}
            }
            await supabaseAdmin.from('publicaciones_externas').update(updateData).eq('id', pub.id);
            successCount++;
        } catch (err: any) {
            const errMsg = err.message || '';
            if (errMsg.toLowerCase().includes('not_modifiable') || errMsg.toLowerCase().includes('not modifiable')) {
                await supabaseAdmin.from('publicaciones_externas').update({ sync_disabled: true, sync_disabled_reason: `MeLi rechaza modificación: ${errMsg.slice(0, 200)}` }).eq('id', pub.id);
                successCount++; continue;
            }
            failedVitrinas.push(`${pub.external_item_id}: ${errMsg}`);
        }
    }
    if (successCount === 0 && failedVitrinas.length > 0) {
        throw new Error(`Todas las vitrinas fallaron: ${failedVitrinas.join(' | ')}`);
    }
}

async function handleSyncPrice(job: any, meli: MeliAdapter) {
    const { publicacion_id } = job.payload;
    const { data: pub } = await supabaseAdmin
        .from('publicaciones_externas')
        .select('marketplace_id, external_item_id, precio_venta')
        .eq('id', publicacion_id)
        .single();
    if (!pub) return;
    await meli.updatePrice(pub.marketplace_id, [{ itemId: pub.external_item_id, price: pub.precio_venta }]);
}

async function handleSyncStockMapped(job: any, meli: MeliAdapter) {
    const { publicacion_id } = job.payload;
    const { data: pub } = await supabaseAdmin
        .from('publicaciones_externas')
        .select('id, marketplace_id, external_item_id, es_fuente_stock, logistic_type, status_externo')
        .eq('id', publicacion_id)
        .single();
    if (!pub) return;
    if (pub.logistic_type === 'fulfillment') return;

    const { data: components } = await supabaseAdmin
        .from('mapeo_publicacion_articulo')
        .select('articulo_id, cantidad_requerida')
        .eq('publicacion_id', publicacion_id);
    if (!components || components.length === 0) return;

    let maxKits = 999999;
    for (const comp of components) {
        const compStock = await SKU_Service.calculateAvailableStock(comp.articulo_id);
        maxKits = Math.min(maxKits, Math.floor(compStock / comp.cantidad_requerida));
    }
    const finalStock = Math.max(0, maxKits);
    await meli.updateStock(pub.marketplace_id, [{ itemId: pub.external_item_id, quantity: finalStock }]);
    await supabaseAdmin.from('publicaciones_externas')
        .update({ stock_publicado: finalStock, actualizado_el: new Date().toISOString() })
        .eq('id', pub.id);

    // B1: Pause/activate automático — el flujo sync_stock_mapped es el principal (2173 ejecuciones)
    // pero no tenía esta lógica. Ahora sí la tiene, igual que handleSyncStock.
    if (finalStock > 0 && pub.status_externo === 'paused') {
        try {
            await meli.activateListing(pub.marketplace_id, pub.external_item_id);
            await supabaseAdmin.from('publicaciones_externas')
                .update({ status_externo: 'active' }).eq('id', pub.id);
        } catch (_) {}
    } else if (finalStock === 0 && pub.status_externo === 'active') {
        try {
            await meli.pauseListing(pub.marketplace_id, pub.external_item_id);
            await supabaseAdmin.from('publicaciones_externas')
                .update({ status_externo: 'paused' }).eq('id', pub.id);
        } catch (_) {}
    }
}

// ========================================
// V31: Handler process_sale (portado de apps/worker/src/processor.ts)
// ========================================
async function handleProcessSale(job: any, meli: MeliAdapter) {
    const { resource, user_id } = job.payload;

    // Extraer order_id del resource "/orders/12345678"
    const orderIdMatch = String(resource).match(/\/orders\/(\d+)/);
    if (!orderIdMatch) {
        logger.warn({ resource }, 'process_sale: no se pudo extraer order_id del resource');
        return;
    }
    const meliOrderId = parseInt(orderIdMatch[1], 10);

    // 1. Buscar cuenta (marketplace_id) por meli_user_id en settings
    const { data: configs } = await supabaseAdmin
        .from('marketplace_configs')
        .select('id, settings')
        .in('marketplace', ['meli', 'mercadolibre']);

    const config = (configs || []).find((c: any) =>
        String(c.settings?.seller_id) === String(user_id)
    );

    if (!config) {
        logger.warn({ user_id }, 'process_sale: no se encontró marketplace_config para meli_user_id');
        await supabaseAdmin.from('system_alerts').insert({
            level: 'warning', type: 'orders_sync',
            message: `Orden ${meliOrderId} recibida pero no hay cuenta MeLi configurada para user_id ${user_id}`,
            metadata: { meli_order_id: meliOrderId, meli_user_id: user_id }
        });
        return;
    }
    const marketplaceId = config.id;

    // 2. Obtener detalle completo de la orden desde MeLi
    const accessToken = await (meli as any).getAccessToken(marketplaceId);
    const orderResp = await fetch(
        `https://api.mercadolibre.com/orders/${meliOrderId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!orderResp.ok) {
        throw new Error(`MeLi API order fetch failed: HTTP ${orderResp.status}`);
    }
    const order = await orderResp.json();

    // 3. Determinar logistic_type desde publicaciones_externas (primer item)
    const firstItemId = order.order_items?.[0]?.item?.id;
    let shippingLogisticType: string | null = null;
    if (firstItemId) {
        const { data: pub } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('logistic_type')
            .eq('external_item_id', firstItemId)
            .eq('marketplace_id', marketplaceId)
            .eq('external_variation_id', '0')
            .maybeSingle();
        shippingLogisticType = pub?.logistic_type ?? null;
    }

    // 4. Upsert en tabla ordenes
    const { data: ordenUpserted, error: ordenErr } = await supabaseAdmin
        .from('ordenes')
        .upsert({
            marketplace_id: marketplaceId,
            meli_order_id: order.id,
            pack_id: order.pack_id ?? null,
            status: order.status,
            date_created: order.date_created,
            date_closed: order.date_closed ?? null,
            buyer_id: order.buyer?.id,
            total_amount: order.total_amount,
            paid_amount: order.paid_amount ?? null,
            currency_id: order.currency_id ?? 'MXN',
            shipping_id: order.shipping?.id ?? null,
            shipping_logistic_type: shippingLogisticType,
            buying_mode: order.buying_mode ?? null,
            tags: order.tags ?? [],
            raw_json: order,
            updated_at: new Date().toISOString()
        }, { onConflict: 'marketplace_id,meli_order_id' })
        .select('id, status')
        .single();

    if (ordenErr || !ordenUpserted) {
        throw new Error(`Error en upsert de orden ${meliOrderId}: ${ordenErr?.message}`);
    }
    const ordenId = ordenUpserted.id;
    logger.info({ meliOrderId, ordenId, status: order.status }, 'Orden procesada/actualizada');

    // 5. Si la orden fue cancelada: liberar reservaciones activas
    if (order.status === 'cancelled') {
        const { data: itemsToFree } = await supabaseAdmin
            .from('orden_items')
            .select('id')
            .eq('orden_id', ordenId);
        const itemIdsToFree = (itemsToFree || []).map((i: any) => i.id);
        if (itemIdsToFree.length > 0) {
            await supabaseAdmin
                .from('reservaciones_stock')
                .update({ estado: 'liberada', updated_at: new Date().toISOString() })
                .eq('estado', 'activa')
                .in('orden_item_id', itemIdsToFree);
        }
        logger.info({ ordenId }, 'Reservaciones liberadas por cancelación');
        return;
    }

    // 6. Procesar cada order_item
    for (const item of (order.order_items || [])) {
        const meliItemId = item.item?.id;
        const variationId = item.item?.variation_id ? String(item.item.variation_id) : null;
        const quantity = item.quantity;
        const unitPrice = item.unit_price;
        const fullUnitPrice = item.full_unit_price ?? null;
        const sellerSku = item.item?.seller_sku || item.item?.seller_custom_field || null;
        if (!meliItemId) continue;

        const variationQuery = variationId ?? '0';
        const variationUpsert = variationId ?? '0';

        // Resolver publicacion_id
        let publicacionId: string | null = null;
        let articuloId: string | null = null;

        const { data: pubRow } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('id')
            .eq('marketplace_id', marketplaceId)
            .eq('external_item_id', meliItemId)
            .eq('external_variation_id', variationQuery)
            .maybeSingle();

        const pubResult = pubRow ?? (variationId ? (await supabaseAdmin.from('publicaciones_externas').select('id')
            .eq('marketplace_id', marketplaceId)
            .eq('external_item_id', meliItemId)
            .eq('external_variation_id', '0')
            .maybeSingle()).data : null);

        publicacionId = pubResult?.id ?? null;

        if (publicacionId) {
            const { data: mapRow } = await supabaseAdmin
                .from('mapeo_publicacion_articulo')
                .select('articulo_id')
                .eq('publicacion_id', publicacionId)
                .maybeSingle();
            articuloId = mapRow?.articulo_id ?? null;
        }

        if (!publicacionId) {
            await supabaseAdmin.from('system_alerts').insert({
                level: 'info', type: 'orders_sync',
                message: `Item MeLi ${meliItemId} de orden ${meliOrderId} no tiene publicación mapeada en el Gestor`,
                metadata: { meli_item_id: meliItemId, meli_order_id: meliOrderId }
            });
        }

        // Upsert orden_item
        const { data: ordenItem, error: itemErr } = await supabaseAdmin
            .from('orden_items')
            .upsert({
                orden_id: ordenId,
                meli_item_id: meliItemId,
                meli_variation_id: variationUpsert,
                titulo: item.item?.title ?? null,
                quantity,
                unit_price: unitPrice,
                full_unit_price: fullUnitPrice,
                seller_sku: sellerSku,
                publicacion_id: publicacionId,
                articulo_id: articuloId
            }, { onConflict: 'orden_id,meli_item_id,meli_variation_id' })
            .select('id')
            .single();

        if (itemErr || !ordenItem) {
            logger.error({ meliItemId, itemErr }, 'Error en upsert de orden_item');
            continue;
        }

        // 7. Crear reservación de stock (solo si no-Fulfillment, artículo resuelto, orden pagada)
        const esFulfillment = shippingLogisticType === 'fulfillment';
        if (!esFulfillment && articuloId && order.status === 'paid') {
            const { data: existingReserv } = await supabaseAdmin
                .from('reservaciones_stock')
                .select('id')
                .eq('orden_item_id', ordenItem.id)
                .eq('estado', 'activa')
                .maybeSingle();

            if (!existingReserv) {
                await supabaseAdmin.from('reservaciones_stock').insert({
                    orden_item_id: ordenItem.id,
                    articulo_id: articuloId,
                    cantidad: quantity,
                    estado: 'activa'
                });
                logger.info({ articuloId, quantity }, 'Reservación de stock creada');
            }
        }

        // 8. Si la orden está entregada (tag 'delivered'): consumir reservación
        // NO se crea egreso aquí — AppSheet registra el egreso físico real vía sincEgresos.
        // El egreso del worker en delivered duplicaba el egreso manual de AppSheet,
        // causando doble conteo en fn_recalcular_stock → physical_stock artificialmente bajo.
        const isDelivered = (order.tags || []).includes('delivered');
        if (isDelivered && articuloId) {
            await supabaseAdmin
                .from('reservaciones_stock')
                .update({ estado: 'consumida', updated_at: new Date().toISOString() })
                .eq('orden_item_id', ordenItem.id)
                .eq('estado', 'activa');
            logger.info({ articuloId, meliOrderId }, 'Reservación consumida por entrega de orden MeLi');
        }
    }
}
