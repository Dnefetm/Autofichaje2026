import { supabase } from '@gestor/shared/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import logger from '@gestor/shared/lib/logger';

const meliAdapter = new MeliAdapter();

export async function runReconciliation() {
    logger.info('Iniciando proceso de reconciliación de inventario (v2 — mapeo_publicacion_articulo)...');

    try {
        // 1. Obtener publicaciones que son fuente de stock y están mapeadas
        const { data: publicaciones, error } = await supabase
            .from('publicaciones_externas')
            .select('id, marketplace_id, external_item_id, stock_publicado')
            .eq('es_fuente_stock', true)
            .eq('esta_mapeado', true);

        if (error) throw error;
        if (!publicaciones || publicaciones.length === 0) {
            logger.info('No hay publicaciones fuente-de-stock mapeadas para reconciliar.');
            return;
        }

        logger.info({ count: publicaciones.length }, 'Publicaciones fuente-de-stock a reconciliar');

        for (const pub of publicaciones) {
            try {
                // 2. Calcular stock local basado en ensamble (Kit-Aware)
                const { data: componentes } = await supabase
                    .from('mapeo_publicacion_articulo')
                    .select('articulo_id, cantidad_requerida')
                    .eq('publicacion_id', pub.id);

                if (!componentes || componentes.length === 0) continue;

                let localStock = 999999;
                for (const comp of componentes) {
                    const { data: inv } = await supabase
                        .from('inventory_snapshot')
                        .select('physical_stock')
                        .eq('sku', comp.articulo_id)
                        .single();

                    const physicalStock = inv?.physical_stock || 0;
                    const reachableKits = Math.floor(physicalStock / comp.cantidad_requerida);
                    if (reachableKits < localStock) localStock = reachableKits;
                }
                localStock = Math.max(0, localStock === 999999 ? 0 : localStock);

                // 3. Obtener stock remoto de MeLi
                const remoteStock = await meliAdapter.getStock(
                    pub.marketplace_id,
                    pub.external_item_id
                );

                if (localStock !== remoteStock) {
                    logger.warn({
                        publicacion_id: pub.id,
                        external_item_id: pub.external_item_id,
                        localStock,
                        remoteStock,
                        marketplace: pub.marketplace_id
                    }, 'Discrepancia de stock detectada');

                    // Registrar discrepancia en logs
                    await supabase.from('sync_logs').insert({
                        marketplace_id: pub.marketplace_id,
                        operation: 'reconciliation_fix',
                        items_count: 1,
                        error_details: {
                            publicacion_id: pub.id,
                            external_item_id: pub.external_item_id,
                            expected: localStock,
                            found: remoteStock,
                            message: 'Discrepancia detectada durante reconciliación automática (v2)'
                        }
                    });

                    // Corregir MeLi — la base local es la verdad
                    await supabase.from('jobs').insert({
                        type: 'sync_stock_mapped',
                        payload: {
                            publicacion_id: pub.id
                        },
                        status: 'pending'
                    });
                }
            } catch (err: any) {
                logger.error({ publicacion_id: pub.id, error: err.message }, 'Error reconciliando publicación');
            }
        }

        logger.info('Reconciliación v2 finalizada.');
    } catch (err) {
        logger.error({ err }, 'Fallo crítico en el servicio de reconciliación');
    }
}
