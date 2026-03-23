import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { MeliTokenManager } from '@gestor/adapters/meli-tokens';
import { SKU_Service } from '@gestor/shared/sku-service';
import { AutomationManager } from '@gestor/sync/automations';
import { runReconciliation } from '@gestor/sync/reconciliation';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby permite hasta 60s

const BATCH_SIZE = 3; // Conservador para evitar rate limits de MeLi

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
        // 2. TTL Cleanup — Borrar jobs viejos (>7 días) con status terminal
        const { count: cleanedCount } = await supabaseAdmin
            .from('jobs')
            .delete({ count: 'exact' })
            .in('status', ['failed', 'completed'])
            .lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

        results.ttlCleaned = cleanedCount || 0;

        // 3. Refresh proactivo de tokens próximos a expirar (< 10 min)
        try {
            await MeliTokenManager.refreshExpiringTokens();
            results.tokensRefreshed = true;
        } catch (tokenErr: any) {
            results.errors.push(`Token refresh failed: ${tokenErr.message}`);
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
        // (Promise.allSettled causaba ráfagas que saturaban el rate limiter)
        const meliAdapter = new MeliAdapter();

        for (const job of jobs) {
            try {
                await processOneJob(job, meliAdapter);
                results.jobResults.push({ id: job.id, type: job.type, status: 'ok' });
            } catch (err: any) {
                results.jobResults.push({ id: job.id, type: job.type, status: 'error', error: err.message });
            }

            // 3 segundos de respiro entre jobs para no saturar MeLi
            await new Promise(r => setTimeout(r, 3000));
        }
        results.jobsProcessed = jobs.length;

        // 5. Reconciliación periódica (~cada 30 min, ventana de 2 min por si cron tiene latencia)
        const currentMinute = new Date().getMinutes();
        if (currentMinute % 30 < 2) {
            try {
                await runReconciliation();
                (results as any).reconciliation = 'executed';
            } catch (reconErr: any) {
                results.errors.push(`Reconciliation failed: ${reconErr.message}`);
            }
        }

    } catch (err: any) {
        results.errors.push(`Fatal: ${err.message}`);
    }

    return NextResponse.json(results);
}

// ========================================
// Procesamiento de un solo job
// ========================================
async function processOneJob(job: any, meli: MeliAdapter) {
    // Protección anti-zombis: si el job ya agotó sus intentos, matarlo inmediatamente
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
                // Sync completo de una cuenta — se crea al re-vincular OAuth
                const accountId = job.payload.marketplace_id;
                const itemIds = await meli.getAccountItems(accountId);
                console.log(`[sync_account_catalog] Syncing ${itemIds.length} items for account ${accountId}`);
                for (const itemId of itemIds) {
                    try {
                        await meli.syncCatalogItem(accountId, itemId);
                    } catch (err: any) {
                        console.warn(`[sync_account_catalog] Failed to sync ${itemId}:`, err.message);
                    }
                    // Throttle: 1 segundo entre items para no saturar MeLi
                    await new Promise(r => setTimeout(r, 1000));
                }
                break;
            }
            default:
                throw new Error(`Tipo de job no soportado: ${job.type}`);
        }

        // Marcar completado
        await supabaseAdmin.from('jobs').update({ status: 'completed' }).eq('id', job.id);

    } catch (error: any) {
        const errMessage = (error.message || JSON.stringify(error)).toLowerCase();

        // Auth/permission errors (403, forbidden) → fallo inmediato, no reintentar
        // Estos no se arreglan solos — requieren re-autenticación manual
        const isAuthError = errMessage.includes('403') ||
            errMessage.includes('forbidden') ||
            errMessage.includes('not authorized') ||
            errMessage.includes('token expirado') ||
            errMessage.includes('no se pudo renovar');

        if (isAuthError) {
            await supabaseAdmin.from('jobs').update({
                status: 'failed',
                attempts: (job.attempts || 0) + 1,
                error_log: `AUTH ERROR (requiere re-autenticación en /settings): ${error.message}`
            }).eq('id', job.id);
            return;
        }

        // Items no modificables (fulfillment, catálogo bloqueado) → fallo inmediato
        const isNotModifiable = errMessage.includes('not_modifiable') ||
            errMessage.includes('not modifiable');

        if (isNotModifiable) {
            await supabaseAdmin.from('jobs').update({
                status: 'failed',
                attempts: (job.attempts || 0) + 1,
                error_log: `ITEM NO MODIFICABLE (fulfillment/catálogo): ${error.message}`
            }).eq('id', job.id);
            return;
        }

        // Rate Limit detection — covers internal rate limiter AND MeLi HTTP 429
        const isRateLimit = errMessage.includes('rate limit') ||
            errMessage.includes('too_many_requests') ||
            errMessage.includes('429') ||
            errMessage.includes('too many requests');

        if (isRateLimit) {
            const attempts = (job.attempts || 0) + 1;
            const maxRateLimitRetries = 10;

            if (attempts >= maxRateLimitRetries) {
                await supabaseAdmin.from('jobs').update({
                    status: 'failed',
                    attempts,
                    error_log: `Rate Limit persistente tras ${attempts} intentos. Abortado.`
                }).eq('id', job.id);
                return;
            }

            const backoffMs = Math.min(attempts * 2 * 60 * 1000, 15 * 60 * 1000);
            await supabaseAdmin.from('jobs').update({
                status: 'pending',
                attempts,
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
            error_log: error.message || errMessage,
            scheduled_at: new Date(Date.now() + Math.pow(2, nextAttempt) * 1000).toISOString()
        }).eq('id', job.id);

        if (isFinal) {
            try {
                await supabaseAdmin.from('system_alerts').insert({
                    level: 'warning',
                    type: 'job_dlq',
                    message: `Job ${job.id} (${job.type}) fracasó tras ${nextAttempt} intentos.`,
                    metadata: { job_id: job.id, final_error: error.message }
                });
            } catch (_) { /* No fallar si system_alerts no existe */ }
        }

        throw error;
    }
}

// ========================================
// Handlers (misma lógica que processor.ts del worker de Render)
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

    if (!mappings || mappings.length === 0) {
        // No hay mapeos — nada que sincronizar a MeLi, pero el stock local ya está guardado
        return;
    }

        const fuentesStock = mappings.filter((m: any) => m.publicaciones_externas); // V30: sin filtro es_fuente_stock
    if (fuentesStock.length === 0) return;

    const failedVitrinas: string[] = [];
    let successCount = 0;

    for (const mapping of fuentesStock) {
        const pub = mapping.publicaciones_externas as any;

        try {
            // Saltar publicaciones deshabilitadas permanentemente (fulfillment, catálogo)
            if (pub.sync_disabled === true) {
                console.log(`[handleSyncStock] Saltando ${pub.external_item_id} — sync_disabled=true`);
                successCount++; // No contar como fallo
                continue;
            }

                        // Saltar publicaciones Full (el stock lo gestiona MeLi)
                        if (pub.logistic_type === 'fulfillment') {
                                            console.log(`[handleSyncStock] Saltando ${pub.external_item_id} -- logistic_type=fulfillment`);
                                            successCount++;
                                            continue;
                                        }

            // Calcular stock kit-aware (dividir por cantidad_requerida)
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

            // Enviar a MeLi
            const results = await meli.updateStock(pub.marketplace_id, [{ itemId: pub.external_item_id, quantity: finalStock }]);
            const errors = results.filter((r: any) => r.status === 'error');
            if (errors.length > 0) {
                const firstError = errors[0].error;
                const errMsg = typeof firstError === 'object' ? JSON.stringify(firstError) : firstError;
                throw new Error(`MeLi API: ${errMsg}`);
            }

            // Actualizar stock local en publicaciones_externas
            const updateData: any = { stock_publicado: finalStock, actualizado_el: new Date().toISOString() };

            // Auto-activar si hay stock y está pausada
            if (finalStock > 0 && pub.status_externo === 'paused') {
                try {
                    await meli.activateListing(pub.marketplace_id, pub.external_item_id);
                    updateData.status_externo = 'active';
                    console.log(`[handleSyncStock] Vitrina ${pub.external_item_id} reactivada (stock: ${finalStock})`);
                } catch (activateErr: any) {
                    console.warn(`[handleSyncStock] No se pudo reactivar ${pub.external_item_id}:`, activateErr.message);
                }
            }

            // Auto-pausar si no hay stock y está activa
            if (finalStock === 0 && pub.status_externo === 'active') {
                try {
                    await meli.pauseListing(pub.marketplace_id, pub.external_item_id);
                    updateData.status_externo = 'paused';
                    console.log(`[handleSyncStock] Vitrina ${pub.external_item_id} pausada (stock: 0)`);
                } catch (pauseErr: any) {
                    console.warn(`[handleSyncStock] No se pudo pausar ${pub.external_item_id}:`, pauseErr.message);
                }
            }

            await supabaseAdmin.from('publicaciones_externas')
                .update(updateData)
                .eq('id', pub.id);

            successCount++;
        } catch (err: any) {
            const errMsg = err.message || '';

            // Si MeLi rechaza permanentemente (fulfillment/catálogo) → marcar sync_disabled
            if (errMsg.toLowerCase().includes('not_modifiable') || errMsg.toLowerCase().includes('not modifiable')) {
                console.warn(`[handleSyncStock] ${pub.external_item_id} es no-modificable — marcando sync_disabled=true`);
                await supabaseAdmin.from('publicaciones_externas').update({
                    sync_disabled: true,
                    sync_disabled_reason: `MeLi rechaza modificación: ${errMsg.slice(0, 200)}`
                }).eq('id', pub.id);
                successCount++; // No es un fallo del sistema, es una limitación de MeLi
                continue;
            }

            // Registrar fallo pero CONTINUAR con las demás vitrinas
            failedVitrinas.push(`${pub.external_item_id}: ${errMsg}`);
            console.warn(`[handleSyncStock] Fallo vitrina ${pub.external_item_id}, continuando:`, errMsg);
        }
    }

    // Si TODAS fallaron, lanzar error para que el job haga retry
    if (successCount === 0 && failedVitrinas.length > 0) {
        throw new Error(`Todas las vitrinas fallaron: ${failedVitrinas.join(' | ')}`);
    }
    // Si algunas fallaron pero otras sí: el job se marca como completed (arriba)
    // Las vitrinas fallidas se reintentan en el próximo ciclo del cron
}

async function handleSyncPrice(job: any, meli: MeliAdapter) {
    const { publicacion_id } = job.payload;

    const { data: pub } = await supabaseAdmin
        .from('publicaciones_externas')
        .select('marketplace_id, external_item_id, precio_venta')
        .eq('id', publicacion_id)
        .single();

    if (!pub) return;

    await meli.updatePrice(pub.marketplace_id, [{
        itemId: pub.external_item_id,
        price: pub.precio_venta
    }]);
}

async function handleSyncStockMapped(job: any, meli: MeliAdapter) {
    const { publicacion_id } = job.payload;

    const { data: pub } = await supabaseAdmin
        .from('publicaciones_externas')
        .select('id, marketplace_id, external_item_id, es_fuente_stock, logistic_type')
        .eq('id', publicacion_id)
        .single();

    if (!pub) return; // V30: sin filtro es_fuente_stock — si está mapeada, se sincroniza

        // Saltar publicaciones Full (el stock lo gestiona MeLi)
        if (pub.logistic_type === 'fulfillment') {
                    console.log(`[handleSyncStockMapped] Saltando ${pub.external_item_id} -- logistic_type=fulfillment`);
                    return;
                }

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
}
