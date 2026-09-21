// =============================================================================
// WORKER OFICIAL Y UNICO (Vercel). Esta es la fuente de verdad para los jobs.
// El worker standalone de Render/Docker (apps/worker) fue RETIRADO y NO se
// reactivara. Ver apps/worker/DEPRECATED.md. Toda la logica de jobs vive aqui.
// =============================================================================
import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { MeliTokenManager } from '@gestor/adapters/meli-tokens';
import { SKU_Service } from '@gestor/shared/sku-service';
import { AutomationManager } from '@gestor/sync/automations';
import { runReconciliation } from '@gestor/sync/reconciliation';
import logger from '@/lib/logger';
import axios from 'axios';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Hobby permite hasta 60s

const BATCH_SIZE = 10;
// V130 (jobs resumibles): tamaños de chunk por fase del catálogo.
const CATALOG_SCAN_PAGES = 20;        // páginas por invocación en la fase scan
const CATALOG_UPSERT_CHUNK = 1000;    // ítems por invocación en la fase upsert
const CATALOG_RECONCILE_CHUNK = 1000; // ítems por invocación en la fase reconcile

export async function GET(req: NextRequest) {
const authHeader = req.headers.get('authorization');
const expectedSecret = process.env.CRON_SECRET;
if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
const startTimeMs = Date.now();

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

const { count } = await supabaseAdmin
.from('jobs')
.select('*', { count: 'exact', head: true })
.eq('status', 'pending');

const isMaintenanceWindow = (currentMinute % 5 === 0);
const isReconciliationHour = (currentHour % 6 === 0 && currentMinute < 2);
const isCatalogHour = (currentHour % 8 === 0 && currentMinute < 2);

if (count === 0 && !isMaintenanceWindow && !isReconciliationHour && !isCatalogHour) {
return NextResponse.json({ ...results, skipped: true, reason: 'no_jobs', ms: Date.now() - now.getTime() });
}

if (isMaintenanceWindow) {
try {
await MeliTokenManager.refreshExpiringTokens();
results.tokensRefreshed = true;
} catch (tokenErr: any) {
results.errors.push(`Token refresh failed: ${tokenErr.message}`);
}

const { count: cleanedCount } = await supabaseAdmin
.from('jobs')
.delete({ count: 'exact' })
.in('status', ['failed', 'completed'])
.lt('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
results.ttlCleaned = cleanedCount || 0;

const { data: zombieData } = await supabaseAdmin.rpc('release_zombie_jobs');
if (zombieData && zombieData > 0) {
logger.info({ zombiesReleased: zombieData }, 'Reaper: jobs zombi liberados');
}
}

if (count === 0 && !isReconciliationHour && !isCatalogHour) {
return NextResponse.json({ ...results, skipped: true, reason: 'no_jobs_maintenance_done' });
}

const meliAdapter = new MeliAdapter();
let totalProcessed = 0;

// Drenar la cola en lotes dentro de UNA invocación, hasta vaciarla o acercarnos
// a maxDuration=60 (margen para devolver y responder). Reemplaza el esquema
// "1 lote + re-dispatch" que no daba abasto.
while (Date.now() - startTimeMs < 25000) {
const { data: batch, error: claimErr } = await supabaseAdmin.rpc('claim_jobs', { batch_size_limit: BATCH_SIZE });
if (claimErr) {
results.errors.push(`claim_jobs RPC error: ${claimErr.message}`);
break;
}
if (!batch || batch.length === 0) break;

const doneIds = new Set<string>();
for (const job of batch) {
if (Date.now() - startTimeMs > 25000) break;
try {
const result = await processOneJob(job, meliAdapter);
if (result.done) {
results.jobResults.push({ id: job.id, type: job.type, status: 'ok' });
} else {
// Continuación (V130): re-encolar con checkpoint, sin cobrar intento si hubo progreso.
const before = JSON.stringify(job.checkpoint ?? null);
const after = JSON.stringify(result.checkpoint ?? null);
const madeProgress = after !== before;
await supabaseAdmin.from('jobs').update({
status: 'pending',
checkpoint: result.checkpoint ?? null,
scheduled_at: new Date().toISOString(),
attempts: madeProgress ? 0 : (job.attempts || 0) + 1,
}).eq('id', job.id);
results.jobResults.push({ id: job.id, type: job.type, status: 'resumed' });
}
} catch (err: any) {
results.jobResults.push({ id: job.id, type: job.type, status: 'error', error: err.message });
}
doneIds.add(job.id);
totalProcessed++;
await new Promise(r => setTimeout(r, 1000));
}

// Devolver a 'pending' los jobs de este lote que no alcanzamos a procesar,
// sin cobrar intento (claim_jobs/release_zombie_jobs ya no cobran tras v127).
const unprocessed = batch.filter((j: any) => !doneIds.has(j.id)).map((j: any) => j.id);
if (unprocessed.length > 0) {
await supabaseAdmin.from('jobs').update({ status: 'pending' }).in('id', unprocessed);
}
}

results.jobsProcessed = totalProcessed;

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

    // Auto-drenado (drain-until-empty):
    // Si quedan jobs pendientes, nos auto-despachamos saltando el lock de 10s de dispatchWorker
    // para evitar romper la cadena en lotes rápidos (< 10s).
    try {
      const { count: remaining } = await supabaseAdmin
        .from('jobs')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString());

      if ((remaining || 0) > 0) {
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
        // `after()` garantiza que el fetch sobreviva al return de la respuesta (Vercel
        // congela la función al responder; sin esto el re-dispatch puede morir a medias).
        after(() => {
          fetch(`${baseUrl}/api/worker/process`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
          }).catch(() => {});
        });
      }
    } catch (_) {}

    return NextResponse.json(results);
}

async function processOneJob(job: any, meli: MeliAdapter): Promise<{ done: boolean; checkpoint?: any }> {
const maxAttempts = job.max_attempts || 3;
if ((job.attempts || 0) >= maxAttempts) {
// Preservar el error real del intento anterior (no pisarlo con "Zombie killed").
const errorLog = (job.error_log && !String(job.error_log).startsWith('Zombie killed'))
? job.error_log
: `Agotados ${maxAttempts} intentos sin error registrado`;
await supabaseAdmin.from('jobs').update({ status: 'failed', error_log: errorLog }).eq('id', job.id);
return { done: true };
}

try {
let resume: { done: boolean; checkpoint?: any } = { done: true };
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
case 'recalc_pricing_bundle':
await handleRecalcPricingBundle(job);
break;
case 'sync_account_catalog':
resume = await handleSyncAccountCatalog(job, meli);
break;
case 'process_sale':
await handleProcessSale(job, meli);
break;
case 'confirm_matching_batch':
await handleConfirmMatchingBatch(job);
break;
default:
throw new Error(`Tipo de job no soportado: ${job.type}`);
}

if (resume.done) {
await supabaseAdmin.from('jobs').update({ status: 'completed', processed_at: new Date().toISOString() }).eq('id', job.id);
}
return resume;
} catch (error: any) {
const errMessage = (error.message || JSON.stringify(error)).toLowerCase();

const isAuthError = errMessage.includes('403') || errMessage.includes('forbidden') || errMessage.includes('not authorized') || errMessage.includes('token expirado') || errMessage.includes('no se pudo renovar');
if (isAuthError) {
await supabaseAdmin.from('jobs').update({ status: 'failed', attempts: (job.attempts || 0) + 1, processed_at: new Date().toISOString(), error_log: `AUTH ERROR (requiere re-autenticación en /settings): ${error.message}` }).eq('id', job.id);
return { done: true };
}

const isNotModifiable = errMessage.includes('not_modifiable') || errMessage.includes('not modifiable');
if (isNotModifiable) {
await supabaseAdmin.from('jobs').update({ status: 'failed', attempts: (job.attempts || 0) + 1, processed_at: new Date().toISOString(), error_log: `ITEM NO MODIFICABLE (fulfillment/catálogo): ${error.message}` }).eq('id', job.id);
return { done: true };
}

const isRateLimit = errMessage.includes('rate limit') || errMessage.includes('too_many_requests') || errMessage.includes('429') || errMessage.includes('too many requests');
if (isRateLimit) {
const attempts = (job.attempts || 0) + 1;
const maxRateLimitRetries = 10;
if (attempts >= maxRateLimitRetries) {
await supabaseAdmin.from('jobs').update({ status: 'failed', attempts, processed_at: new Date().toISOString(), error_log: `Rate Limit persistente tras ${attempts} intentos. Abortado.` }).eq('id', job.id);
return { done: true };
}
const backoffMs = Math.min(attempts * 2 * 60 * 1000, 15 * 60 * 1000);
await supabaseAdmin.from('jobs').update({ status: 'pending', attempts, processed_at: new Date().toISOString(), scheduled_at: new Date(Date.now() + backoffMs).toISOString(), error_log: `Rate Limit. Reintento ${attempts}/${maxRateLimitRetries} en ${Math.round(backoffMs/60000)}min.` }).eq('id', job.id);
return { done: true };
}

const nextAttempt = (job.attempts || 0) + 1;
const isFinal = nextAttempt >= (job.max_attempts || 5);
await supabaseAdmin.from('jobs').update({ status: isFinal ? 'failed' : 'pending', attempts: nextAttempt, processed_at: new Date().toISOString(), error_log: error.message || errMessage, scheduled_at: new Date(Date.now() + Math.pow(2, nextAttempt) * 1000).toISOString() }).eq('id', job.id);

if (isFinal) {
try {
await supabaseAdmin.from('system_alerts').insert({ level: 'warning', type: 'job_dlq', message: `Job ${job.id} (${job.type}) fracasó tras ${nextAttempt} intentos.`, metadata: { job_id: job.id, final_error: error.message } });
} catch (_) { /* No fallar si system_alerts no existe */ }
}
throw error;
}
}

// V130: máquina de fases resumible para sync_account_catalog.
// Cada invocación procesa un chunk acotado y guarda su posición en job.checkpoint.
async function handleSyncAccountCatalog(job: any, meli: MeliAdapter): Promise<{ done: boolean; checkpoint?: any }> {
    const accountId = job.payload.marketplace_id;
    const cp = (job.checkpoint && typeof job.checkpoint === 'object') ? job.checkpoint : { phase: 'scan', userId: null, scrollId: null, itemIds: [], offset: 0 };

    if (cp.phase === 'scan') {
        const accessToken = await (meli as any).getAccessToken(accountId);
        let userId = cp.userId;
        if (!userId) {
            const meResp = await axios.get('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${accessToken}` } });
            userId = meResp.data.id;
        }
        const scan = await meli.getAccountItemsPage(accountId, accessToken, userId, cp.scrollId, CATALOG_SCAN_PAGES);
        const itemIds = (cp.itemIds || []).concat(scan.itemIds);
        if (scan.done) {
            return { done: false, checkpoint: { phase: 'upsert', itemIds, offset: 0 } };
        }
        return { done: false, checkpoint: { phase: 'scan', userId, scrollId: scan.scrollId, itemIds } };
    }

    if (cp.phase === 'upsert') {
        const accessToken = await (meli as any).getAccessToken(accountId);
        const sliceSize = Math.min(CATALOG_UPSERT_CHUNK, cp.itemIds.length - cp.offset);
        await meli.syncCatalogBatchFast(accountId, accessToken, cp.itemIds, cp.offset, sliceSize);
        const newOffset = cp.offset + sliceSize;
        if (newOffset >= cp.itemIds.length) {
            return { done: false, checkpoint: { phase: 'reconcile', offset: 0 } };
        }
        return { done: false, checkpoint: { phase: 'upsert', itemIds: cp.itemIds, offset: newOffset } };
    }

    if (cp.phase === 'reconcile') {
        const reconcile = await meli.reconcileClosedItems(accountId, cp.offset || 0, CATALOG_RECONCILE_CHUNK);
        const newOffset = (cp.offset || 0) + reconcile.checked;
        if (reconcile.checked < CATALOG_RECONCILE_CHUNK) {
            return { done: true };
        }
        return { done: false, checkpoint: { phase: 'reconcile', offset: newOffset } };
    }

    return { done: true };
}

// ========================================
// Handler recalc_pricing_bundle
// Recalcula el precio de una publicacion en la BD (fn_recalcular_precio_publicacion:
// aplica overrides / regla pricing v3, escribe publicaciones_externas y
// publication_pricing_history) y luego encola sync_price para propagar a MeLi.
// Enqueued por trg_costos_articulo_recalcular_async cuando cambia costos_articulo.
// ========================================
async function handleRecalcPricingBundle(job: any) {
const { publicacion_id } = job.payload;
if (!publicacion_id) {
throw new Error('recalc_pricing_bundle: payload sin publicacion_id');
}

// 1. Recalcular precio en la BD (fuente de verdad del pricing v3)
const { error: rpcErr } = await supabaseAdmin.rpc('fn_recalcular_precio_publicacion', { p_publicacion_id: publicacion_id });
if (rpcErr) {
throw new Error(`fn_recalcular_precio_publicacion fallo para ${publicacion_id}: ${rpcErr.message}`);
}

// 2. Leer resultado del recalculo para decidir si se propaga a MeLi
const { data: pub, error: pubErr } = await supabaseAdmin
.from('publicaciones_externas')
.select('id, pricing_status, sync_disabled')
.eq('id', publicacion_id)
.single();
if (pubErr || !pub) {
throw new Error(`recalc_pricing_bundle: no se pudo leer publicacion ${publicacion_id}: ${pubErr?.message}`);
}

// Solo propagar si el recalculo fue exitoso y la sync no esta deshabilitada
if (pub.sync_disabled === true) {
logger.info({ publicacion_id }, 'recalc_pricing_bundle: sync deshabilitada, no se encola sync_price');
return;
}
if (pub.pricing_status && pub.pricing_status !== 'ok') {
logger.warn({ publicacion_id, pricing_status: pub.pricing_status }, 'recalc_pricing_bundle: precio no valido, no se propaga a MeLi');
return;
}

// 3. Encolar sync_price para propagar a MeLi (dedupe con ON CONFLICT en BD si aplica)
await supabaseAdmin.from('jobs').insert({
type: 'sync_price',
payload: { publicacion_id },
status: 'pending',
priority: 5,
});
logger.info({ publicacion_id }, 'recalc_pricing_bundle: precio recalculado y sync_price encolado');
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
publicacion_id,
cantidad_requerida,
sincronizar_stock,
publicaciones_externas!inner (id, marketplace_id, external_item_id, es_fuente_stock, status_externo, sync_disabled, logistic_type)
`)
.eq('articulo_id', sku);
if (!mappings || mappings.length === 0) return;

const fuentesStock = mappings.filter((m: any) => m.publicaciones_externas && m.sincronizar_stock !== false);
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
.select('articulo_id, cantidad_requerida, sincronizar_stock')
.eq('publicacion_id', pub.id);

const syncOnComponents = (allComponents || []).filter((c: any) => c.sincronizar_stock !== false);
if (syncOnComponents.length === 0) { successCount++; continue; }

let maxKits = availableStock;
if (syncOnComponents.length > 0) {
maxKits = 999999;
for (const comp of syncOnComponents) {
const compStock = await SKU_Service.calculateAvailableStock(comp.articulo_id);
maxKits = Math.min(maxKits, Math.floor(compStock / comp.cantidad_requerida));
}
}
const finalStock = Math.max(0, maxKits);

const syncResults = await meli.updateStock(pub.marketplace_id, [{ itemId: pub.external_item_id, quantity: finalStock }]);
const errors = syncResults.filter((r: any) => r.status === 'error');
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
successCount++;
continue;
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
if (pub.logistic_type === 'fulfillment') {
// Self-healing: verificar en MeLi si sigue Full (pudo cambiar a no-full sin detectarse).
try {
const accessToken = await (meli as any).getAccessToken(pub.marketplace_id);
const resp = await axios.get(`https://api.mercadolibre.com/items/${pub.external_item_id}`, {
headers: { Authorization: `Bearer ${accessToken}` },
});
const currentLogistic = resp.data?.shipping?.logistic_type || null;
if (currentLogistic === 'fulfillment') return; // sigue Full
await supabaseAdmin.from('publicaciones_externas')
.update({ logistic_type: currentLogistic, actualizado_el: new Date().toISOString() })
.eq('id', pub.id);
} catch (_) {
return; // no se pudo verificar; conservador: no pisar stock Full
}
}

const { data: components } = await supabaseAdmin
.from('mapeo_publicacion_articulo')
.select('articulo_id, cantidad_requerida, sincronizar_stock')
.eq('publicacion_id', publicacion_id);
if (!components || components.length === 0) return;

const syncOnComponents = components.filter((c: any) => c.sincronizar_stock !== false);
if (syncOnComponents.length === 0) {
logger.info({ publicacion_id }, 'Todos los mapeos tienen sincronizar_stock=false. Omitiendo sync de stock.');
return;
}

let maxKits = 999999;
for (const comp of syncOnComponents) {
const compStock = await SKU_Service.calculateAvailableStock(comp.articulo_id);
maxKits = Math.min(maxKits, Math.floor(compStock / comp.cantidad_requerida));
}
const finalStock = Math.max(0, maxKits);

await meli.updateStock(pub.marketplace_id, [{ itemId: pub.external_item_id, quantity: finalStock }]);
await supabaseAdmin.from('publicaciones_externas')
.update({ stock_publicado: finalStock, actualizado_el: new Date().toISOString() })
.eq('id', pub.id);

if (finalStock > 0 && pub.status_externo === 'paused') {
try {
await meli.activateListing(pub.marketplace_id, pub.external_item_id);
await supabaseAdmin.from('publicaciones_externas').update({ status_externo: 'active' }).eq('id', pub.id);
} catch (_) {}
} else if (finalStock === 0 && pub.status_externo === 'active') {
try {
await meli.pauseListing(pub.marketplace_id, pub.external_item_id);
await supabaseAdmin.from('publicaciones_externas').update({ status_externo: 'paused' }).eq('id', pub.id);
} catch (_) {}
}
}

// ========================================
// T1: acumula una venta por código ML en la tabla diaria (ventas_diarias_ml).
// ========================================
async function acumularVentaML(marketplaceId: string, codigoMl: string, fechaIso: string | null, unidades: number) {
    const fechaDia = fechaIso ? fechaIso.slice(0, 10) : new Date().toISOString().slice(0, 10);
    try {
        await supabaseAdmin.rpc('upsert_venta_diaria_ml', {
            p_marketplace_id: marketplaceId,
            p_codigo_ml: codigoMl,
            p_fecha_dia: fechaDia,
            p_unidades: unidades,
        });
    } catch (e: any) {
        logger.warn({ marketplaceId, codigoMl, error: e?.message }, 'ventas_diarias_ml: no se pudo acumular');
    }
}

// ========================================
// Handler process_sale
// ========================================
async function handleProcessSale(job: any, meli: MeliAdapter) {
const { resource, user_id } = job.payload;
const orderIdMatch = String(resource).match(/\/orders\/(\d+)/);
if (!orderIdMatch) {
logger.warn({ resource }, 'process_sale: no se pudo extraer order_id del resource');
return;
}
const meliOrderId = parseInt(orderIdMatch[1], 10);

const { data: configs } = await supabaseAdmin
.from('marketplace_configs')
.select('id, settings')
.in('marketplace', ['meli', 'mercadolibre']);
const config = (configs || []).find((c: any) => String(c.settings?.seller_id) === String(user_id));
if (!config) {
logger.warn({ user_id }, 'process_sale: no se encontro marketplace_config para meli_user_id');
await supabaseAdmin.from('system_alerts').insert({ level: 'warning', type: 'orders_sync', message: `Orden ${meliOrderId} recibida pero no hay cuenta MeLi configurada para user_id ${user_id}`, metadata: { meli_order_id: meliOrderId, meli_user_id: user_id } });
return;
}
const marketplaceId = config.id;

const accessToken = await (meli as any).getAccessToken(marketplaceId);
const orderResp = await fetch(`https://api.mercadolibre.com/orders/${meliOrderId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
if (!orderResp.ok) {
throw new Error(`MeLi API order fetch failed: HTTP ${orderResp.status}`);
}
const order = await orderResp.json();

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
logger.info({ ordenId }, 'Reservaciones liberadas por cancelacion');
return;
}

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

let publicacionId: string | null = null;
let articuloId: string | null = null;

const { data: pubRow } = await supabaseAdmin
.from('publicaciones_externas')
.select('id, inventory_id')
.eq('marketplace_id', marketplaceId)
.eq('external_item_id', meliItemId)
.eq('external_variation_id', variationQuery)
.maybeSingle();
const pubResult = pubRow ?? (variationId ? (await supabaseAdmin.from('publicaciones_externas').select('id, inventory_id')
.eq('marketplace_id', marketplaceId)
.eq('external_item_id', meliItemId)
.eq('external_variation_id', '0')
.maybeSingle()).data : null);
publicacionId = pubResult?.id ?? null;
const inventoryId = pubResult?.inventory_id ?? null;

// T1: acumular la venta por código ML (demanda de reposición Full).
if (inventoryId && quantity > 0) {
await acumularVentaML(marketplaceId, inventoryId, order.date_created, quantity);
}

if (publicacionId) {
const { data: mapRow } = await supabaseAdmin
.from('mapeo_publicacion_articulo')
.select('articulo_id')
.eq('publicacion_id', publicacionId)
.maybeSingle();
articuloId = mapRow?.articulo_id ?? null;
}

if (!publicacionId) {
await supabaseAdmin.from('system_alerts').insert({ level: 'info', type: 'orders_sync', message: `Item MeLi ${meliItemId} de orden ${meliOrderId} no tiene publicacion mapeada en el Gestor`, metadata: { meli_item_id: meliItemId, meli_order_id: meliOrderId } });
}

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

const esFulfillment = shippingLogisticType === 'fulfillment';
if (!esFulfillment && articuloId && order.status === 'paid') {
const { data: existingReserv } = await supabaseAdmin
.from('reservaciones_stock')
.select('id')
.eq('orden_item_id', ordenItem.id)
.eq('estado', 'activa')
.maybeSingle();
if (!existingReserv) {
await supabaseAdmin.from('reservaciones_stock').insert({ orden_item_id: ordenItem.id, articulo_id: articuloId, cantidad: quantity, estado: 'activa' });
logger.info({ articuloId, quantity }, 'Reservacion de stock creada');
}
}

const isDelivered = (order.tags || []).includes('delivered');
if (isDelivered && articuloId) {
await supabaseAdmin
.from('reservaciones_stock')
.update({ estado: 'consumida', updated_at: new Date().toISOString() })
.eq('orden_item_id', ordenItem.id)
.eq('estado', 'activa');
logger.info({ articuloId, meliOrderId }, 'Reservacion consumida por entrega de orden MeLi');
}
}
}

const CHUNK_SIZE = 200;

async function handleConfirmMatchingBatch(job: any) {
const confirmJobId = job.payload?.confirm_job_id as string;
if (!confirmJobId) throw new Error('missing confirm_job_id');

// 1) Marcar running (idempotente)
const { data: cj, error: e1 } = await supabaseAdmin
.from('matching_confirm_jobs')
.update({ status: 'running', started_at: new Date().toISOString() })
.eq('id', confirmJobId)
.in('status', ['queued', 'running'])
.select('id, importacion_id, decisiones, processed, total')
.single();

if (e1 || !cj) throw new Error(`confirm_job not claimable: ${e1?.message}`);

const decisiones: Array<{ id: string; articulo_id: string }> = cj.decisiones ?? [];
const startIdx = cj.processed ?? 0;
let totalConfirmadas = 0;
let totalAliases = 0;
const affectedArticulos = new Set<string>();

try {
// 2) Chunkear y llamar RPC — idempotente por UNIQUE(importacion_id, ...)
for (let i = startIdx; i < decisiones.length; i += CHUNK_SIZE) {
const chunk = decisiones.slice(i, i + CHUNK_SIZE);
const { data, error } = await supabaseAdmin.rpc('fn_confirmar_matching_decisiones', {
_importacion_id: cj.importacion_id,
_decisiones: chunk,
});
if (error) throw error;
const row = Array.isArray(data) ? data[0] : data;
totalConfirmadas += row?.decisiones_confirmadas ?? 0;
totalAliases += row?.alias_aprendidos ?? 0;

chunk.forEach((d: any) => affectedArticulos.add(d.articulo_id));
// Checkpoint de progreso
await supabaseAdmin
.from('matching_confirm_jobs')
.update({ processed: i + chunk.length, alias_aprendidos: totalAliases })
.eq('id', confirmJobId);
}

// 3) Expandir a duplicados por GTIN
const { data: dupes } = await supabaseAdmin
.from('articulos')
.select('articulo_id, codigo_universal')
.in('articulo_id', [...affectedArticulos]);
const gtins = [...new Set((dupes ?? []).map((d: any) => d.codigo_universal).filter(Boolean))];

const { data: allDupes } = await supabaseAdmin
.from('articulos')
.select('articulo_id')
.in('codigo_universal', gtins);
(allDupes ?? []).forEach((a: any) => affectedArticulos.add(a.articulo_id));

// 4) Encolar recalc_pricing_bundle
const { data: mappings } = await supabaseAdmin
  .from('mapeo_publicacion_articulo')
  .select('publicacion_id')
  .in('articulo_id', [...affectedArticulos]);

const affectedPublicaciones = new Set(mappings?.map(m => m.publicacion_id));

const recalcRows = [...affectedPublicaciones].map(publicacion_id => ({
type: 'recalc_pricing_bundle',
payload: { publicacion_id },
priority: 3,
status: 'pending'
}));
if (recalcRows.length) {
await supabaseAdmin.from('jobs').insert(recalcRows);
}

// 5) Marcar done
await supabaseAdmin
.from('matching_confirm_jobs')
.update({
status: 'done',
finished_at: new Date().toISOString(),
alias_aprendidos: totalAliases,
})
.eq('id', confirmJobId);

} catch (err: any) {
await supabaseAdmin
.from('matching_confirm_jobs')
.update({
status: 'failed',
error: err?.message ?? String(err),
finished_at: new Date().toISOString()
})
.eq('id', confirmJobId);
throw err;
}
}
