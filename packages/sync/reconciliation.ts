import { supabase } from '@gestor/shared/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import logger from '@gestor/shared/lib/logger';

const meliAdapter = new MeliAdapter();

export async function runReconciliation() {
    logger.info('Iniciando proceso de reconciliación de inventario...');

    try {
        // 1. Obtener mapeos activos de MeLi
        const { data: mappings, error } = await supabase
            .from('sku_marketplace_mapping')
            .select(`
                sku,
                marketplace_id,
                external_item_id,
                external_variation_id,
                skus (
                    inventory_snapshot (physical_stock)
                )
            `)
            .eq('sync_status', 'active');

        if (error) throw error;
        if (!mappings || mappings.length === 0) {
            logger.info('No hay productos activos para reconciliar.');
            return;
        }

        logger.info({ count: mappings.length }, 'Procesando productos para reconciliación');

        for (const mapping of mappings) {
            try {
                // Extraer el stock físico con la nueva estructura del JOIN
                const skusData = mapping.skus || {};
                const snapshot = Array.isArray(skusData) ? skusData[0]?.inventory_snapshot : skusData.inventory_snapshot;

                const localStock = (Array.isArray(snapshot) ? snapshot[0]?.physical_stock : snapshot?.physical_stock) || 0;
                const remoteStock = await meliAdapter.getStock(
                    mapping.marketplace_id,
                    mapping.external_item_id,
                    mapping.external_variation_id
                );

                if (localStock !== remoteStock) {
                    logger.warn({
                        sku: mapping.sku,
                        localStock,
                        remoteStock,
                        marketplace: mapping.marketplace_id
                    }, 'Discrepancia de stock detectada');

                    // 1. Registrar discrepancia en logs
                    await supabase.from('sync_logs').insert({
                        marketplace_id: mapping.marketplace_id,
                        operation: 'reconciliation_fix',
                        items_count: 1,
                        error_details: {
                            sku: mapping.sku,
                            expected: localStock,
                            found: remoteStock,
                            message: 'Discrepancia detectada durante reconciliación automática'
                        }
                    });

                    // 2. Corregir MeLi (Prioridad: La base de datos local es la verdad)
                    await supabase.from('jobs').insert({
                        type: 'sync_stock',
                        payload: {
                            sku: mapping.sku,
                            newStock: localStock,
                            marketplace_id: mapping.marketplace_id
                        },
                        status: 'pending'
                    });
                }
            } catch (err: any) {
                logger.error({ sku: mapping.sku, error: err.message }, 'Error reconciliando producto');
            }
        }

        logger.info('Reconciliación finalizada.');
    } catch (err) {
        logger.error({ err }, 'Fallo crítico en el servicio de reconciliación');
    }
}
