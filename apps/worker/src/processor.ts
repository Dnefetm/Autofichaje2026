import { supabase } from '@gestor/shared/lib/supabase';
import logger from '@gestor/shared/lib/logger';
import { MeliAdapter } from '@gestor/adapters/meli';
import { AutomationManager } from '@gestor/sync/automations';

const meliAdapter = new MeliAdapter();

const POLLING_INTERVAL = 5000; // 5 segundos

export async function startProcessor() {
    logger.info('Iniciando procesador de jobs...');

    while (true) {
        try {
            const { data: job, error } = await supabase
                .from('jobs')
                .select('*')
                .eq('status', 'pending')
                .order('scheduled_at', { ascending: true })
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') {
                logger.error({ error }, 'Error al consultar la tabla de jobs');
            }

            if (job) {
                await processJob(job);
            } else {
                // No hay jobs pendientes, esperar el intervalo
                await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
            }
        } catch (err) {
            logger.error({ err }, 'Error inesperado en el bucle principal');
            await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL));
        }
    }
}

async function processJob(job: any) {
    logger.info({ jobId: job.id, type: job.type }, 'Procesando job');

    // 1. Marcar como procesando
    await supabase.from('jobs').update({ status: 'processing', processed_at: new Date().toISOString() }).eq('id', job.id);

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
            default:
                logger.warn({ type: job.type }, 'Tipo de job no soportado aún');
        }

        // 3. Marcar como completado
        await supabase.from('jobs').update({ status: 'completed' }).eq('id', job.id);
        logger.info({ jobId: job.id }, 'Job completado con éxito');
    } catch (error: any) {
        const nextAttempt = job.attempts + 1;
        const isFinalFailure = nextAttempt >= job.max_attempts;

        logger.error({ jobId: job.id, attempts: nextAttempt, error: error.message || error }, 'Error procesando job');

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

    await meliAdapter.updateStock(marketplace_id, [
        { itemId: mapping.external_item_id, variationId: mapping.external_variation_id, quantity: availableStock }
    ]);
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

    await meliAdapter.updatePrice(marketplace_id, [
        { itemId: mapping.external_item_id, variationId: mapping.external_variation_id, price: newPrice }
    ]);
}
