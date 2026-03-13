import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { MeliTokenManager } from '@gestor/adapters/meli-tokens';
import { SKU_Service } from '@gestor/shared/sku-service';
import { AutomationManager } from '@gestor/sync/automations';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby permite hasta 60s

const BATCH_SIZE = 5;

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

        // Procesar cada job con allSettled para no perder el batch si uno falla
        const meliAdapter = new MeliAdapter();
        const jobPromises = jobs.map((job: any) => processOneJob(job, meliAdapter));
        const settled = await Promise.allSettled(jobPromises);

        for (let i = 0; i < settled.length; i++) {
            const result = settled[i];
            const job = jobs[i];
            if (result.status === 'fulfilled') {
                results.jobResults.push({ id: job.id, type: job.type, status: 'ok' });
            } else {
                results.jobResults.push({ id: job.id, type: job.type, status: 'error', error: result.reason?.message });
            }
        }
        results.jobsProcessed = jobs.length;

    } catch (err: any) {
        results.errors.push(`Fatal: ${err.message}`);
    }

    return NextResponse.json(results);
}

// ========================================
// Procesamiento de un solo job
// ========================================
async function processOneJob(job: any, meli: MeliAdapter) {
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
            default:
                throw new Error(`Tipo de job no soportado: ${job.type}`);
        }

        // Marcar completado
        await supabaseAdmin.from('jobs').update({ status: 'completed' }).eq('id', job.id);

    } catch (error: any) {
        const errMessage = (error.message || JSON.stringify(error)).toLowerCase();

        // Rate Limit detection — covers internal rate limiter AND MeLi HTTP 429
        const isRateLimit = errMessage.includes('rate limit') ||
            errMessage.includes('too_many_requests') ||
            errMessage.includes('429') ||
            errMessage.includes('too many requests');

        if (isRateLimit) {
            const attempts = (job.attempts || 0) + 1;
            const maxRateLimitRetries = 10;

            if (attempts >= maxRateLimitRetries) {
                // Demasiados rate limits — marcar como failed
                await supabaseAdmin.from('jobs').update({
                    status: 'failed',
                    attempts,
                    error_log: `Rate Limit persistente tras ${attempts} intentos. Abortado.`
                }).eq('id', job.id);
                return;
            }

            // Backoff exponencial: 2min, 5min, 10min, 15min max
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
            await supabaseAdmin.from('system_alerts').insert({
                level: 'warning',
                type: 'job_dlq',
                message: `Job ${job.id} (${job.type}) fracasó tras ${nextAttempt} intentos.`,
                metadata: { job_id: job.id, final_error: error.message }
            }).catch(() => {}); // No fallar si system_alerts no existe
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
            publicaciones_externas!inner (id, marketplace_id, external_item_id, es_fuente_stock)
        `)
        .eq('articulo_id', sku);

    if (!mappings || mappings.length === 0) {
        // No hay mapeos — nada que sincronizar a MeLi, pero el stock local ya está guardado
        return;
    }

    const fuentesStock = mappings.filter((m: any) => m.publicaciones_externas?.es_fuente_stock === true);
    if (fuentesStock.length === 0) return;

    for (const mapping of fuentesStock) {
        const pub = mapping.publicaciones_externas as any;

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

        // Enviar a MeLi — si falla, LANZAR error para que el job haga retry
        const results = await meli.updateStock(pub.marketplace_id, [{ itemId: pub.external_item_id, quantity: finalStock }]);
        const errors = results.filter((r: any) => r.status === 'error');
        if (errors.length > 0) {
            const firstError = errors[0].error;
            const errMsg = typeof firstError === 'object' ? JSON.stringify(firstError) : firstError;
            throw new Error(`MeLi updateStock failed for ${pub.external_item_id}: ${errMsg}`);
        }

        // Actualizar stock local en publicaciones_externas
        await supabaseAdmin.from('publicaciones_externas')
            .update({ stock_publicado: finalStock, actualizado_el: new Date().toISOString() })
            .eq('id', pub.id);
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

    await meli.updatePrice(pub.marketplace_id, [{
        itemId: pub.external_item_id,
        price: pub.precio_venta
    }]);
}

async function handleSyncStockMapped(job: any, meli: MeliAdapter) {
    const { publicacion_id } = job.payload;

    const { data: pub } = await supabaseAdmin
        .from('publicaciones_externas')
        .select('id, marketplace_id, external_item_id, es_fuente_stock')
        .eq('id', publicacion_id)
        .single();

    if (!pub || !pub.es_fuente_stock) return;

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
