import { supabase } from '@gestor/shared/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import logger from '@gestor/shared/lib/logger';

const meliAdapter = new MeliAdapter();

export async function runReconciliation() {
    logger.info('Iniciando reconciliación de inventario (v3 — multiGET batch)...');

    try {
        // 1. Obtener publicaciones que son fuente de stock, mapeadas y no-fulfillment.
        // Filtramos fulfillment en la query SQL — más eficiente que hacerlo en el loop.
        const { data: publicaciones, error } = await supabase
            .from('publicaciones_externas')
            .select('id, marketplace_id, external_item_id, stock_publicado, logistic_type')
            .eq('es_fuente_stock', true)
            .eq('esta_mapeado', true)
            .neq('logistic_type', 'fulfillment');

        if (error) throw error;
        if (!publicaciones || publicaciones.length === 0) {
            logger.info('No hay publicaciones fuente-de-stock mapeadas para reconciliar.');
            return;
        }

        logger.info({ count: publicaciones.length }, 'Publicaciones a reconciliar (v3 multiGET)');

        // 2. Agrupar por marketplace_id — así hacemos 1 batch de multiGET por cuenta,
        //    no uno global (cada cuenta tiene su propio access token).
        const byAccount = new Map<string, typeof publicaciones>();
        for (const pub of publicaciones) {
            if (!byAccount.has(pub.marketplace_id)) byAccount.set(pub.marketplace_id, []);
            byAccount.get(pub.marketplace_id)!.push(pub);
        }

        for (const [accountId, pubs] of byAccount.entries()) {
            try {
                // 3. multiGET de stock remoto: 1 call por cada 20 items (vs 1 GET por item antes).
                //    getStockBatch hace chunks internamente, retorna Map<itemId, availableQty>.
                const itemIds = pubs.map(p => p.external_item_id);
                const remoteStockMap = await meliAdapter.getStockBatch(accountId, itemIds);

                // 4. Comparar stock local vs remoto y encolar sync_stock_mapped si hay discrepancia.
                for (const pub of pubs) {
                    try {
                        // Si el item no está en el Map (error en chunk del multiGET),
                        // lo saltamos para no generar una discrepancia falsa positiva.
                        if (!remoteStockMap.has(pub.external_item_id)) continue;
                        const remoteStock = remoteStockMap.get(pub.external_item_id)!;

                        // Calcular stock local — Kit-Aware (mismo algoritmo que v2)
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

                        if (localStock !== remoteStock) {
                            logger.warn({
                                publicacion_id: pub.id,
                                external_item_id: pub.external_item_id,
                                localStock,
                                remoteStock,
                                marketplace: pub.marketplace_id
                            }, 'Discrepancia de stock detectada');

                            // Registrar discrepancia en logs (igual que v2)
                            await supabase.from('sync_logs').insert({
                                marketplace_id: pub.marketplace_id,
                                operation: 'reconciliation_fix',
                                items_count: 1,
                                error_details: {
                                    publicacion_id: pub.id,
                                    external_item_id: pub.external_item_id,
                                    expected: localStock,
                                    found: remoteStock,
                                    message: 'Discrepancia detectada durante reconciliación automática (v3)'
                                }
                            });

                            // Deduplicación: no crear job si ya hay uno pending para esta publicación
                            const { data: existingJob } = await supabase
                                .from('jobs')
                                .select('id')
                                .eq('type', 'sync_stock_mapped')
                                .eq('status', 'pending')
                                .contains('payload', { publicacion_id: pub.id })
                                .maybeSingle();

                            if (!existingJob) {
                                await supabase.from('jobs').insert({
                                    type: 'sync_stock_mapped',
                                    payload: { publicacion_id: pub.id },
                                    status: 'pending'
                                });
                            }
                        }
                    } catch (err: any) {
                        logger.error({ publicacion_id: pub.id, error: err.message }, 'Error reconciliando publicación individual');
                    }
                }
            } catch (err: any) {
                logger.error({ accountId, error: err.message }, 'Error en reconciliación de cuenta');
            }
        }

        logger.info('Reconciliación v3 finalizada.');
    } catch (err) {
        logger.error({ err }, 'Fallo crítico en el servicio de reconciliación');
    }
}
