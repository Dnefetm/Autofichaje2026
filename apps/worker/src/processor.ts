import { supabase } from '@gestor/shared/lib/supabase';
import logger from '@gestor/shared/lib/logger';
import { MeliAdapter } from '@gestor/adapters/meli';
import { AutomationManager } from '@gestor/sync/automations';

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
            default:
                throw new Error(`Tipo de job no soportado aún: ${job.type}`);
        }

        // 3. Marcar como completado
        await supabase.from('jobs').update({ status: 'completed' }).eq('id', job.id);
        logger.info({ jobId: job.id }, 'Job completado con éxito');
    } catch (error: any) {
        const nextAttempt = job.attempts + 1;
        const isFinalFailure = nextAttempt >= job.max_attempts;

        // 3. Evaluar fallo definitivo para Dead-Letter Queue / Alertas
        if (isFinalFailure) {
            await supabase.from('system_alerts').insert({
                level: 'warning',
                type: 'job_dlq',
                message: `El Job ${job.id} de tipo ${job.type} fracasó definitivamente tras ${job.max_attempts} intentos. Revisa el log de errores.`,
                metadata: { job_id: job.id, final_error: error.message || error }
            });
            logger.warn({ jobId: job.id }, 'Job enviado al DLQ de System Alerts');
        }

        await supabase.from('jobs').update({
            status: isFinalFailure ? 'failed' : 'pending',
            attempts: nextAttempt,
            error_log: error.message || JSON.stringify(error),
            scheduled_at: new Date(Date.now() + Math.pow(2, nextAttempt) * 1000).toISOString()
        }).eq('id', job.id);
    }
}

import { SKU_Service } from '@gestor/shared/sku-service';

async function handleSyncStock(job: any) {
    const { sku, marketplace_id } = job.payload;

    // 1. Calcular el stock real considerando si es un PACK/BUNDLE
    const availableStock = await SKU_Service.calculateAvailableStock(sku);

    const { data: mapping } = await supabase
        .from('sku_marketplace_mapping')
        .select('external_item_id, external_variation_id')
        .eq('sku', sku)
        .eq('marketplace_id', marketplace_id)
        .single();

    if (!mapping) throw new Error(`Mapping no encontrado para SKU ${sku}`);

    logger.info({ sku, availableStock, marketplace_id }, 'Sincronizando stock real (Pack-Aware)');

    const results = await meliAdapter.updateStock(marketplace_id, [
        { itemId: mapping.external_item_id, variationId: mapping.external_variation_id, quantity: availableStock }
    ]);

    const errors = results.filter((r: any) => r.status === 'error');
    if (errors.length > 0) {
        throw new Error(`MercadoLibre API Error (Stock): ${JSON.stringify(errors)}`);
    }
}

async function handleSyncPrice(job: any) {
    const { sku, newPrice, marketplace_id } = job.payload;
    const { data: mapping } = await supabase
        .from('sku_marketplace_mapping')
        .select('external_item_id, external_variation_id')
        .eq('sku', sku)
        .eq('marketplace_id', marketplace_id)
        .single();

    if (!mapping) throw new Error(`Mapping no encontrado para SKU ${sku}`);

    const results = await meliAdapter.updatePrice(marketplace_id, [
        { itemId: mapping.external_item_id, variationId: mapping.external_variation_id, price: newPrice }
    ]);

    const errors = results.filter((r: any) => r.status === 'error');
    if (errors.length > 0) {
        throw new Error(`MercadoLibre API Error (Price): ${JSON.stringify(errors)}`);
    }
}

async function handleBulkUpdatePrice(job: any) {
    const { skus, operation, value, marketplace_id } = job.payload;
    logger.info({ count: skus.length, operation, value }, 'Procesando lote masivo de edición de precios');

    // 1. Obtener los precios base actuales de todos los SKUs seleccionados
    const { data: currentPrices, error } = await supabase
        .from('marketplace_prices')
        .select('sku, sale_price')
        .in('sku', skus)
        .eq('marketplace_id', marketplace_id);

    if (error) throw new Error(`Fallo al consultar precios actuales: ${error.message}`);

    const updates = [];
    const individualSyncJobs = [];

    for (const sku of skus) {
        let newPrice = 0;

        if (operation === 'fixed') {
            newPrice = value;
        } else if (operation === 'percentage') {
            const currentRecord = currentPrices?.find(p => p.sku === sku);
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
            sku,
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
            .upsert(updates, { onConflict: 'sku,marketplace_id' });

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
