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

const BATCH_SIZE = 10;

export async function GET(req: NextRequest) {
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

const { data: jobs, error: claimError } = await supabaseAdmin.rpc('claim_jobs', { batch_size_limit: BATCH_SIZE });
if (claimError) {
results.errors.push(`claim_jobs RPC error: ${claimError.message}`);
return NextResponse.json(results);
}
if (!jobs || jobs.length === 0) {
return NextResponse.json(results);
}

const meliAdapter = new MeliAdapter();
const startTimeMs = Date.now();

for (const job of jobs) {
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
await new Promise(r => setTimeout(r, 1000));
}
results.jobsProcessed = jobs.length;

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

return NextResponse.json(results);
}

async function processOneJob(job: any, meli: MeliAdapter) {
const maxAttempts = job.max_attempts || 10;
if ((job.attempts || 0) >= maxAttempts) {
await supabaseAdmin.from('jobs').update({ status: 'failed', error_log: `Zombie killed: attempts ${job.attempts} >= max_attempts ${maxAttempts}` }).eq('id', job.id);
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
case 'recalc_pricing_bundle':
await handleRecalcPricingBundle(job);
break;
case 'sync_account_catalog': {
const accountId = job.payload.marketplace_id;
const itemIds = await meli.getAccountItems(accountId);
console.log(`[sync_account_catalog] Syncing ${itemIds.length} items for account ${accountId} via multiGET batch`);
const accessToken = await (meli as any).getAccessToken(accountId);
await meli.syncCatalogBatchFast(accountId, accessToken, itemIds);
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

await supabaseAdmin.from('jobs').update({ status: 'completed', processed_at: new Date().toISOString() }).eq('id', job.id);
} catch (error: any) {
const errMessage = (error.message || JSON.stringify(error)).toLowerCase();

const isAuthError = errMessage.includes('403') || errMessage.includes('forbidden') || errMessage.includes('not authorized') || errMessage.includes('token expirado') || errMessage.includes('no se pudo renovar');
if (isAuthError) {
await supabaseAdmin.from('jobs').update({ status: 'failed', attempts: (job.attempts || 0) + 1, processed_at: new Date().toISOString(), error_log: `AUTH ERROR (requiere re-autenticación en /settings): ${error.message}` }).eq('id', job.id);
return;
}

const isNotModifiable = errMessage.includes('not_modifiable') || errMessage.includes('not modifiable');
if (isNotModifiable) {
await supabaseAdmin.from('jobs').update({ status: 'failed', attempts: (job.attempts || 0) + 1, processed_at: new Date().toISOString(), error_log: `ITEM NO MODIFICABLE (fulfillment/catálogo): ${error.message}` }).eq('id', job.id);
return;
}

const isRateLimit = errMessage.includes('rate limit') || errMessage.includes('too_many_requests') || errMessage.includes('429') || errMessage.includes('too many requests');
if (isRateLimit) {
const attempts = (job.attempts || 0) + 1;
const maxRateLimitRetries = 10;
if (attempts >= maxRateLimitRetries) {
await supabaseAdmin.from('jobs').update({ status: 'failed', attempts, processed_at: new Date().toISOString(), error_log: `Rate Limit persistente tras ${attempts} intentos. Abortado.` }).eq('id', job.id);
return;
}
const backoffMs = Math.min(attempts * 2 * 60 * 1000, 15 * 60 * 1000);
await supabaseAdmin.from('jobs').update({ status: 'pending', attempts, processed_at: new Date().toISOString(), scheduled_at: new Date(Date.now() + backoffMs).toISOString(), error_log: `Rate Limit. Reintento ${attempts}/${maxRateLimitRetries} en ${Math.round(backoffMs/60000)}min.` }).eq('id', job.id);
return;
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
