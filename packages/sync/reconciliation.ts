import { supabase } from '@gestor/shared/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import logger from '@gestor/shared/lib/logger';

const meliAdapter = new MeliAdapter();

export async function runReconciliation() {
    logger.info('Iniciando reconciliacion de inventario (v4 - multiGET stock+status combinado)...');

    try {
        // 1. Obtener publicaciones que son fuente de stock, mapeadas y no-fulfillment.
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

        logger.info({ count: publicaciones.length }, 'Publicaciones a reconciliar (v4 stock+status combinado)');

        // 2. Agrupar por marketplace_id.
        const byAccount = new Map<string, typeof publicaciones>();
        for (const pub of publicaciones) {
            if (!byAccount.has(pub.marketplace_id)) byAccount.set(pub.marketplace_id, []);
            byAccount.get(pub.marketplace_id)!.push(pub);
        }

        for (const [accountId, pubs] of byAccount.entries()) {
            try {
                // 3. B3: multiGET combinado - stock + status + sub_status en un solo batch.
                //    Reemplaza getStockBatch (solo stock) + llamada separada a reconcileClosedItems.
                const itemIds = pubs.map(p => p.external_item_id);
                const remoteMap = await meliAdapter.getStockAndStatusBatch(accountId, itemIds);

                // 4. Procesar cada publicacion.
                for (const pub of pubs) {
                    try {
                        if (!remoteMap.has(pub.external_item_id)) continue;
                        const remote = remoteMap.get(pub.external_item_id)!;

                        // 4a. Si MeLi reporta status terminal, actualizar BD directamente.
                        if (['closed', 'inactive'].includes(remote.status)) {
                            await supabase.from('publicaciones_externas')
                                .update({
                                    status_externo: remote.status,
                                    sub_status: remote.sub_status,
                                    actualizado_el: new Date().toISOString(),
                                })
                                .eq('marketplace_id', accountId)
                                .eq('external_item_id', pub.external_item_id);
                            logger.info({
                                external_item_id: pub.external_item_id,
                                status: remote.status,
                            }, 'Reconciliacion: status terminal detectado y actualizado en BD');
                            continue; // no reconciliar stock de items cerrados
                        }

                        // 4b. Reconciliar stock (logica existente).
                        const remoteStock = remote.qty;

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

                            await supabase.from('sync_logs').insert({
                                marketplace_id: pub.marketplace_id,
                                operation: 'reconciliation_fix',
                                items_count: 1,
                                error_details: {
                                    publicacion_id: pub.id,
                                    external_item_id: pub.external_item_id,
                                    expected: localStock,
                                    found: remoteStock,
                                    message: 'Discrepancia detectada durante reconciliacion automatica (v4)'
                                }
                            });

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
                        logger.error({ publicacion_id: pub.id, error: err.message }, 'Error reconciliando publicacion individual');
                    }
                }
            } catch (err: any) {
                logger.error({ accountId, error: err.message }, 'Error en reconciliacion de cuenta');
            }
        }

        logger.info('Reconciliacion v4 finalizada.');
    } catch (err) {
        logger.error({ err }, 'Fallo critico en el servicio de reconciliacion');
    }
}