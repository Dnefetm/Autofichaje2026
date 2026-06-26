/**
 * ============================================================================
 * [DEPRECADO - NO USAR] Procesador de jobs del worker standalone (Render).
 * ============================================================================
 *
 * Este modulo (startProcessor / processJob) YA NO SE EJECUTA. El worker de
 * Render fue retirado y su entry point (index.ts) sale de inmediato.
 *
 * La logica de jobs vigente vive EXCLUSIVAMENTE en Vercel:
 *     apps/dashboard/src/app/api/worker/process/route.ts
 *
 * NO reactivar ni importar este archivo. Se conserva solo como referencia
 * historica. Si se necesita cambiar el comportamiento de los jobs, editar
 * el route.ts de Vercel, no este archivo.
 * ============================================================================
 */

import { supabase } from '@gestor/shared/lib/supabase';
import logger from '@gestor/shared/lib/logger';
import { MeliAdapter } from '@gestor/adapters/meli';
import { AutomationManager } from '@gestor/sync/automations';
import axios from 'axios';

const meliAdapter = new MeliAdapter();

const POLLING_INTERVAL = 5000; // 5 segundos

export async function startProcessor() {
    logger.info('Iniciando procesador avanzado de jobs (Batch & Pessimistic Locking)...');

    const BATCH_SIZE = 5; // Empezamos conservadores (5 paralelos) para cuidar la memoria del Free Tier y el Rate Limit
    const EMPTY_QUEUE_INTERVAL = 5000; // Si no hay nada, esperar 5s
    const CONSECUTIVE_PULL_DELAY = 1000; // Si hay más, procesar el siguiente lote después de 1s

    while (true) {
        try {
            // Reemplazamos el peligroso SELECT con el robusto RPC que asigna y bloquea
            const { data: jobs, error } = await supabase.rpc('claim_jobs', { batch_size_limit: BATCH_SIZE });

            if (error) {
                logger.error({ error }, 'Error al consultar el RPC claim_jobs');
            }

            if (jobs && jobs.length > 0) {
                logger.info({ batchCount: jobs.length }, 'Lote de jobs asignado. Procesando...');

                // Procesar concurrente usando allSettled para evitar que 1 fallo tire el batch entero
                await Promise.allSettled(jobs.map((job: any) => processJob(job)));

                // Tras completar un batch full, esperar un instante por sanidad del Node Event Loop
                await new Promise((resolve) => setTimeout(resolve, CONSECUTIVE_PULL_DELAY));
            } else {
                // No hay jobs pendientes, esperar el intervalo
                await new Promise((resolve) => setTimeout(resolve, EMPTY_QUEUE_INTERVAL));
            }
        } catch (err) {
            logger.error({ err }, 'Error inesperado en el bucle principal del Worker');
            await new Promise((resolve) => setTimeout(resolve, EMPTY_QUEUE_INTERVAL));
        }
    }
}

async function processJob(job: any) {
    // 1. Ya NO marcamos como "processing". El RPC de Postgres ya lo marcó de forma atómica.
    logger.info({ jobId: job.id, type: job.type }, 'Ejecutando job claimado');

    try {
        // 2. Ejecutar lógica según el tipo
        switch (job.type) {
            case 'sync_stock':
                await handleSyncStock(job);
                // 4. Evaluar reglas de negocio tras actualizar stock
                await AutomationManager.evaluateStockRules(job.payload.sku, job.payload.newStock);
                break;
            case 'sync_price':
                await handleSyncPrice(job);
                break;
            case 'sync_stock_mapped':
                await handleSyncStockMapped(job);
                break;
            case 'recalc_pricing_bundle':
                await handleRecalcPricingBundle(job);
                break;
            case 'pause_listing':
                await meliAdapter.pauseListing(job.payload.marketplace_id, job.payload.external_item_id);
                break;
            case 'activate_listing':
                await meliAdapter.activateListing(job.payload.marketplace_id, job.payload.external_item_id);
                break;
            case 'bulk_update_price':
                await handleBulkUpdatePrice(job);
                break;
            case 'sync_account_catalog':
                await handleAccountCatalogSync(job);
                break;
            case 'sync_item':
                await meliAdapter.syncCatalogItem(job.payload.marketplace_id, job.payload.external_item_id);
                break;
            case 'process_sale':
                await handleProcessSale(job);
                break;
            default:
                throw new Error(`Tipo de job no soportado aún: ${job.type}`);
        }

        // 3. Marcar como completado
        await supabase.from('jobs').update({ status: 'completed' }).eq('id', job.id);
        logger.info({ jobId: job.id }, 'Job completado con éxito');
    } catch (error: any) {
        const errMessage = error.message || JSON.stringify(error);

        // --- Manejo Especial: Rate Limit ---
        // Si es un rate limit, retrocedemos pacíficamente en lugar de acumular fallos
        if (errMessage.includes('Rate limit excedido')) {
            logger.warn({ jobId: job.id }, 'Rate Limit alcanzado, se re-encolará pacíficamente (15s backoff)');
            await supabase.from('jobs').update({
                status: 'pending',
                // No incrementamos 'attempts' para no causar un fallo final
                scheduled_at: new Date(Date.now() + 15000).toISOString(),
                error_log: 'Rate Limit. Pausado temporalmente.'
            }).eq('id', job.id);
            return;
        }

        const nextAttempt = job.attempts + 1;
        const isFinalFailure = nextAttempt >= job.max_attempts;

        // 3. Evaluar fallo definitivo para Dead-Letter Queue / Alertas
        if (isFinalFailure) {
            await supabase.from('system_alerts').insert({
                level: 'warning',
                type: 'job_dlq',
                message: `El Job ${job.id} de tipo ${job.type} fracasó definitivamente tras ${job.max_attempts} intentos. Revisa el log de errores.`,
                metadata: { job_id: job.id, final_error: errMessage }
            });
            logger.warn({ jobId: job.id }, 'Job enviado al DLQ de System Alerts');
        }

        // Manejo normal de fallos
        await supabase.from('jobs').update({
            status: isFinalFailure ? 'failed' : 'pending',
            attempts: nextAttempt,
            error_log: errMessage,
            scheduled_at: new Date(Date.now() + Math.pow(2, nextAttempt) * 1000).toISOString()
        }).eq('id', job.id);
    }
}

import { SKU_Service } from '@gestor/shared/sku-service';

async function handleSyncStock(job: any) {
    const { sku, marketplace_id } = job.payload;

    // 1. Calcular el stock real considerando si es un PACK/BUNDLE
    const availableStock = await SKU_Service.calculateAvailableStock(sku);

    // 2. Buscar todas las publicaciones donde este artículo está mapeado (solo fuentes de stock)
    const { data: mappings } = await supabase
        .from('mapeo_publicacion_articulo')
        .select(`
            publicacion_id,
            cantidad_requerida,
            publicaciones_externas!inner (
                id,
                marketplace_id,
                external_item_id,
                es_fuente_stock,
            logistic_type
            )
        `)
        .eq('articulo_id', sku);

    if (!mappings || mappings.length === 0) {
        logger.warn({ sku, marketplace_id }, 'Ningún mapeo encontrado para artículo. Ignorando.');
        return;
    }

    // Filtrar solo publicaciones que son fuente de stock y pertenecen al marketplace solicitado
    const fuentesStock = mappings.filter((m: any) => {
        const pub = m.publicaciones_externas;
        return pub && // V30: sin filtro es_fuente_stock
            (!marketplace_id || pub?.marketplace_id === marketplace_id);
    });

    if (fuentesStock.length === 0) {
        logger.warn({ sku, marketplace_id }, 'Artículo mapeado pero ninguna publicación es fuente de stock. Ignorando.');
        return;
    }

    logger.info({ sku, availableStock, affectedListings: fuentesStock.length }, 'Sincronizando stock real a vitrinas mapeadas');

    // Para cada publicación mapeada, recalcular el stock del kit completo
    for (const mapping of fuentesStock) {
        const pub = mapping.publicaciones_externas as any;
        const pubId = pub.id;

                            // Publicaciones Full: obtener stock real desde MeLi (no usar stock de bodega)
            if (pub.logistic_type === 'fulfillment') {
                const mlStock = await meliAdapter.getStock(pub.marketplace_id, pub.external_item_id);
                logger.info({ sku, pubId, external_id: pub.external_item_id, mlStock }, 'Stock Full obtenido desde MeLi API');
                await supabase.from('publicaciones_externas')
                    .update({ stock_publicado: mlStock, actualizado_el: new Date().toISOString() })
                    .eq('id', pubId);
                continue;
            }

        // Traer TODOS los componentes de esta publicación para calcular stock de kit
        const { data: allComponents } = await supabase
            .from('mapeo_publicacion_articulo')
            .select('articulo_id, cantidad_requerida')
            .eq('publicacion_id', pubId);

        let maxKits = 999999;
        if (allComponents && allComponents.length > 0) {
            for (const comp of allComponents) {
                const compStock = await SKU_Service.calculateAvailableStock(comp.articulo_id);
                const reachableKits = Math.floor(compStock / comp.cantidad_requerida);
                if (reachableKits < maxKits) maxKits = reachableKits;
            }
        } else {
            maxKits = availableStock;
        }

        const results = await meliAdapter.updateStock(pub.marketplace_id, [
            { itemId: pub.external_item_id, quantity: Math.max(0, maxKits) }
        ]);

        const errors = results.filter((r: any) => r.status === 'error');
        if (errors.length > 0) {
            logger.error({ sku, pubId, errors }, 'Error sincronizando stock a MeLi');
        }

        // Actualizar stock local
        await supabase.from('publicaciones_externas')
            .update({ stock_publicado: Math.max(0, maxKits), actualizado_el: new Date().toISOString() })
            .eq('id', pubId);
    }
}

async function handleSyncPrice(job: any) {
    const { sku, newPrice, marketplace_id } = job.payload;

    // Buscar publicaciones donde este artículo está mapeado
    const { data: mappings } = await supabase
        .from('mapeo_publicacion_articulo')
        .select(`
            publicaciones_externas!inner (
                marketplace_id,
                external_item_id
            )
        `)
        .eq('articulo_id', sku);

    const pubs = mappings?.map((m: any) => m.publicaciones_externas).filter(Boolean) || [];
    const targetPub = pubs.find((p: any) => p.marketplace_id === marketplace_id);

    if (!targetPub) throw new Error(`Mapeo no encontrado para artículo ${sku} en marketplace ${marketplace_id}`);

    const results = await meliAdapter.updatePrice(marketplace_id, [
        { itemId: targetPub.external_item_id, price: newPrice }
    ]);

    const errors = results.filter((r: any) => r.status === 'error');
    if (errors.length > 0) {
        throw new Error(`MercadoLibre API Error (Price): ${JSON.stringify(errors)}`);
    }
}

async function handleRecalcPricingBundle(job: any) {
    const { publicacion_id } = job.payload;
    
    // 1. Invocar la función SQL para que recalcule y persista el precio localmente
    const { error: calcErr } = await supabase.rpc('fn_recalcular_precio_publicacion', { p_publicacion_id: publicacion_id });
    if (calcErr) throw new Error(`Error en RPC matemático de precio: ${calcErr.message}`);

    // 2. Obtener el precio resultante y los datos para empujar a Meli
    const { data: pub, error: pubErr } = await supabase
        .from('publicaciones_externas')
        .select('marketplace_id, external_item_id, sale_price_calculated, pricing_status')
        .eq('id', publicacion_id)
        .single();
        
    if (pubErr || !pub) throw new Error(`Publicación no encontrada post-cálculo: ${publicacion_id}`);
    
    // Si la matemática arrojó un estado de error grave (como costo <= 0), no empujar basura a Meli
    if (pub.pricing_status === 'error_no_cost') {
        logger.warn({ publicacion_id }, 'El recálculo abortó por falta de costo base. No se envía a Meli.');
        return;
    }

    if (!pub.sale_price_calculated) {
        throw new Error(`El recálculo no generó un precio final válido para la publicación: ${publicacion_id}`);
    }

    // 3. Empujar el nuevo precio a Mercado Libre
    logger.info({ publicacion_id, external_id: pub.external_item_id, price: pub.sale_price_calculated }, 'Sincronizando precio calculado hacia ML (V2)');
    
    const results = await meliAdapter.updatePrice(pub.marketplace_id, [
        { itemId: pub.external_item_id, price: pub.sale_price_calculated }
    ]);

    const errors = results.filter((r: any) => r.status === 'error');
    if (errors.length > 0) {
        throw new Error(`MeLi API Sync Price Error: ${JSON.stringify(errors)}`);
    }
}

async function handleBulkUpdatePrice(job: any) {
    const { skus, operation, value, marketplace_id } = job.payload;
    logger.info({ count: skus.length, operation, value }, 'Procesando lote masivo de edición de precios');

    // 1. Obtener los precios base actuales de todos los SKUs seleccionados
    const { data: currentPrices, error } = await supabase
        .from('marketplace_prices')
        .select('articulo_id, sale_price')
        .in('articulo_id', skus)
        .eq('marketplace_id', marketplace_id);

    if (error) throw new Error(`Fallo al consultar precios actuales: ${error.message}`);

    const updates = [];
    const individualSyncJobs = [];

    for (const sku of skus) {
        let newPrice = 0;

        if (operation === 'fixed') {
            newPrice = value;
        } else if (operation === 'percentage') {
            const currentRecord = currentPrices?.find(p => p.articulo_id === sku);
            // Si no tenía precio registrado antes, asumimos 0 (o podríamos fallar/omitir).
            // Usaremos 0 como punto de quiebre seguro.
            const basePrice = currentRecord?.sale_price || 0;
            if (basePrice <= 0) {
                logger.warn({ sku }, 'No se puede aplicar porcentaje a un SKU sin precio base. Omitiendo.');
                continue;
            }
            // value puede ser 15 (aumento 15%) o -10 (descuento 10%)
            const multiplier = 1 + (value / 100);
            newPrice = parseFloat((basePrice * multiplier).toFixed(2));
        }

        updates.push({
            articulo_id: sku,
            marketplace_id,
            sale_price: newPrice,
            updated_at: new Date().toISOString()
        });

        // Generamos sub-tareas individuales. Así MeLi API se ataca controladamente
        // y si 1 falla por "Precio muy alto", el resto no se frena.
        individualSyncJobs.push({
            type: 'sync_price',
            payload: { sku, newPrice, marketplace_id },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        });
    }

    // 2. Ejecutar la actualización local atómica
    if (updates.length > 0) {
        const { error: upsertError } = await supabase
            .from('marketplace_prices')
            .upsert(updates, { onConflict: 'articulo_id,marketplace_id' });

        if (upsertError) throw new Error(`Error actualizando Precios Locales: ${upsertError.message}`);

        // 3. Encolar los dispatches hacia Mercado Libre
        const { error: jobsError } = await supabase
            .from('jobs')
            .insert(individualSyncJobs);

        if (jobsError) throw new Error(`Error encolando sub-tareas de Sync Price: ${jobsError.message}`);

        logger.info({ updatedCount: updates.length }, 'Cálculo masivo terminado. Sub-tareas de red encoladas exitosamente.');
    } else {
        logger.warn('El lote de edición masiva no generó ningún cambio válido (¿precios en cero?)');
    }
}

async function handleAccountCatalogSync(job: any) {
    const { marketplace_id } = job.payload;
    logger.info({ marketplace_id }, 'Iniciando sincronización masiva de catálogo');

    const itemIds = await meliAdapter.getAccountItems(marketplace_id);

    logger.info({ marketplace_id, count: itemIds.length }, 'Items encontrados para sincronizar');

    for (const itemId of itemIds) {
        await supabase.from('jobs').insert({
            type: 'sync_item',
            payload: {
                marketplace_id,
                external_item_id: itemId
            },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        });
    }
}

async function handleSyncStockMapped(job: any) {
    const { publicacion_id } = job.payload;

    // 1. Obtener publicación y verificar que es fuente de stock
    const { data: pub, error: pubErr } = await supabase
        .from('publicaciones_externas')
        .select('marketplace_id, external_item_id, es_fuente_stock, tipo_publicacion, logistic_type')
        .eq('id', publicacion_id)
        .single();

    if (pubErr || !pub) throw new Error(`Publicación externa no encontrada: ${publicacion_id}`);
    // Publicaciones Full: obtener stock real desde MeLi (no usar stock de bodega)
    if (pub.logistic_type === 'fulfillment') {
        const mlStock = await meliAdapter.getStock(pub.marketplace_id, pub.external_item_id);
        logger.info({ publicacion_id, external_id: pub.external_item_id, mlStock }, 'Stock Full obtenido desde MeLi API');
        await supabase.from('publicaciones_externas')
            .update({ stock_publicado: mlStock, actualizado_el: new Date().toISOString() })
            .eq('id', publicacion_id);
        return;
    }


    if (false && !pub.es_fuente_stock) { // V30: desactivado — si está mapeada, se sincroniza
        logger.info({ publicacion_id, tipo: pub.tipo_publicacion }, 'Publicación no es fuente de stock (espejo/derivada). Omitiendo sync.');
        return;
    }

    // 2. Traer ensamble y snapshot físico
    const { data: mappings, error: mapErr } = await supabase
        .from('mapeo_publicacion_articulo')
        .select('cantidad_requerida, articulo_id')
        .eq('publicacion_id', publicacion_id);

    if (mapErr) throw new Error(`Error obteniendo ensamble: ${mapErr.message}`);

    let maxKits = 0;

    if (mappings && mappings.length > 0) {
        maxKits = 999999;
        for (const map of mappings) {
            const sku = map.articulo_id;
            const qtyNeeded = map.cantidad_requerida;

            if (!sku) continue;

            // Usamos calculateAvailableStock (physical + dropship - reserved)
            const availableStock = await SKU_Service.calculateAvailableStock(sku);
            const reachableKits = Math.floor(availableStock / qtyNeeded);

            if (reachableKits < maxKits) {
                maxKits = reachableKits;
            }
        }
    }

    logger.info({ publicacion_id, maxKits, external_id: pub.external_item_id }, 'Sincronizando stock calculado hacia ML (Ensamble)');

    // 3. Emitir petición real a Mercado Libre API
    const results = await meliAdapter.updateStock(pub.marketplace_id, [
        { itemId: pub.external_item_id, quantity: maxKits }
    ]);

    const errors = results.filter((r: any) => r.status === 'error');
    if (errors.length > 0) {
        throw new Error(`MeLi API Sync Kit Error: ${JSON.stringify(errors)}`);
    }

    // 4. Salvar estado virtual local para mantener consistencia UI
    await supabase.from('publicaciones_externas')
        .update({ stock_publicado: maxKits, actualizado_el: new Date().toISOString() })
        .eq('id', publicacion_id);
}

async function handleProcessSale(job: any) {
    const { resource, user_id } = job.payload;

    // Extraer order_id del resource "/orders/12345678"
    const orderIdMatch = String(resource).match(/\/orders\/(\d+)/);
    if (!orderIdMatch) {
        logger.warn({ resource }, 'process_sale: no se pudo extraer order_id del resource');
        return;
    }
    const meliOrderId = parseInt(orderIdMatch[1], 10);

    // 1. Buscar cuenta (marketplace_id) por meli_user_id en settings
    const { data: configs } = await supabase
        .from('marketplace_configs')
        .select('id, settings')
        .in('marketplace', ['meli', 'mercadolibre']); // Bug 1 fix: DB puede tener 'mercadolibre' (settings route lo inserta así)

    const config = (configs || []).find((c: any) =>
        String(c.settings?.seller_id) === String(user_id) // Bug 2 fix: era 'meli_user_id'
    );

    if (!config) {
        logger.warn({ user_id }, 'process_sale: no se encontró marketplace_config para meli_user_id');
        await supabase.from('system_alerts').insert({
            level: 'warning', type: 'orders_sync',
            message: `Orden ${meliOrderId} recibida pero no hay cuenta MeLi configurada para user_id ${user_id}`,
            metadata: { meli_order_id: meliOrderId, meli_user_id: user_id }
        });
        return;
    }
    const marketplaceId = config.id;

    // 2. Obtener detalle completo de la orden desde MeLi
    const accessToken = await (meliAdapter as any).getAccessToken(marketplaceId);
    const orderResp = await axios.get(
        `https://api.mercadolibre.com/orders/${meliOrderId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const order = orderResp.data;

    // 3. Determinar logistic_type desde publicaciones_externas (primer item)
    const firstItemId = order.order_items?.[0]?.item?.id;
    let shippingLogisticType: string | null = null;
    if (firstItemId) {
        const { data: pub } = await supabase
            .from('publicaciones_externas')
            .select('logistic_type')
            .eq('external_item_id', firstItemId)
            .eq('marketplace_id', marketplaceId)
            .eq('external_variation_id', '0')
            .maybeSingle();
        shippingLogisticType = pub?.logistic_type ?? null;
    }

    // 4. Upsert en tabla ordenes
    const { data: ordenUpserted, error: ordenErr } = await supabase
        .from('ordenes')
        .upsert({
            marketplace_id:         marketplaceId,
            meli_order_id:          order.id,
            pack_id:                order.pack_id ?? null,
            status:                 order.status,
            date_created:           order.date_created,
            date_closed:            order.date_closed ?? null,
            buyer_id:               order.buyer?.id,
            total_amount:           order.total_amount,
            paid_amount:            order.paid_amount ?? null,
            currency_id:            order.currency_id ?? 'MXN',
            shipping_id:            order.shipping?.id ?? null,
            shipping_logistic_type: shippingLogisticType,
            buying_mode:            order.buying_mode ?? null,
            tags:                   order.tags ?? [],
            raw_json:               order,
            updated_at:             new Date().toISOString()
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
        // Bug 5 fix: Supabase JS no soporta subqueries en .in() — fetch previo + array
        const { data: itemsToFree } = await supabase
            .from('orden_items')
            .select('id')
            .eq('orden_id', ordenId);
        const itemIdsToFree = (itemsToFree || []).map((i: any) => i.id);
        if (itemIdsToFree.length > 0) {
            await supabase
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
        const meliItemId    = item.item?.id;
        const variationId   = item.item?.variation_id ? String(item.item.variation_id) : null;
        const quantity      = item.quantity;
        const unitPrice     = item.unit_price;
        const fullUnitPrice = item.full_unit_price ?? null;
        const sellerSku     = item.item?.seller_sku || item.item?.seller_custom_field || null;

        if (!meliItemId) continue;

        // Resolver publicacion_id: buscar por item_id + variacion, fallback a variation='0'
        let publicacionId: string | null = null;
        let articuloId: string | null = null;

        // Bug 4 fix: usar '0' como default en lugar de null para evitar fallo de UNIQUE con NULLs
        const variationQuery = variationId ?? '0';
        const variationUpsert = variationId ?? '0';
        const { data: pubRow } = await supabase
            .from('publicaciones_externas')
            .select('id')
            .eq('marketplace_id', marketplaceId)
            .eq('external_item_id', meliItemId)
            .eq('external_variation_id', variationQuery)
            .maybeSingle();

        // Fallback: buscar fila padre si no encontró por variation
        const pubResult = pubRow ?? (variationId
            ? (await supabase.from('publicaciones_externas').select('id')
                .eq('marketplace_id', marketplaceId)
                .eq('external_item_id', meliItemId)
                .eq('external_variation_id', '0')
                .maybeSingle()).data
            : null);

        publicacionId = pubResult?.id ?? null;

        if (publicacionId) {
            const { data: mapRow } = await supabase
                .from('mapeo_publicacion_articulo')
                .select('articulo_id')
                .eq('publicacion_id', publicacionId)
                .maybeSingle();
            articuloId = mapRow?.articulo_id ?? null;
        }

        if (!publicacionId) {
            await supabase.from('system_alerts').insert({
                level: 'info', type: 'orders_sync',
                message: `Item MeLi ${meliItemId} de orden ${meliOrderId} no tiene publicación mapeada en el Gestor`,
                metadata: { meli_item_id: meliItemId, meli_order_id: meliOrderId }
            });
        }

        // Upsert orden_item (idempotente por orden_id + meli_item_id + variation)
        const { data: ordenItem, error: itemErr } = await supabase
            .from('orden_items')
            .upsert({
                orden_id:          ordenId,
                meli_item_id:      meliItemId,
                meli_variation_id: variationUpsert, // Bug 4 fix: nunca null
                titulo:            item.item?.title ?? null,
                quantity,
                unit_price:        unitPrice,
                full_unit_price:   fullUnitPrice,
                seller_sku:        sellerSku,
                publicacion_id:    publicacionId,
                articulo_id:       articuloId
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
            // Verificar si ya existe reservación activa para esta orden_item
            const { data: existingReserv } = await supabase
                .from('reservaciones_stock')
                .select('id')
                .eq('orden_item_id', ordenItem.id)
                .eq('estado', 'activa')
                .maybeSingle();

            if (!existingReserv) {
                await supabase.from('reservaciones_stock').insert({
                    orden_item_id: ordenItem.id,
                    articulo_id:   articuloId,
                    cantidad:      quantity,
                    estado:        'activa'
                });
                logger.info({ articuloId, quantity }, 'Reservación de stock creada');
            }
        }

        // 8. Si la orden está entregada (tag 'delivered'): consumir reservación y crear egreso
        const isDelivered = (order.tags || []).includes('delivered');
        if (isDelivered && articuloId) {
            // Marcar reservaciones como consumidas
            await supabase
                .from('reservaciones_stock')
                .update({ estado: 'consumida', updated_at: new Date().toISOString() })
                .eq('orden_item_id', ordenItem.id)
                .eq('estado', 'activa');

            // Crear egreso si no existe ya para esta orden
            const referenciaEgreso = `meli_${meliOrderId}_${meliItemId}`;
            const { data: existingEgreso } = await supabase
                .from('egresos')
                .select('id')
                .eq('notas', referenciaEgreso)
                .maybeSingle();

            if (!existingEgreso) {
                await supabase.from('egresos').insert({
                    articulo_id: articuloId,
                    cantidad:    quantity,
                    tipo_egreso: 'venta',
                    notas:       referenciaEgreso,
                    fecha:       order.date_closed ?? new Date().toISOString()
                });
                logger.info({ articuloId, quantity, meliOrderId }, 'Egreso creado por entrega de orden MeLi');
            }
        }
    }
}
