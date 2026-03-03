import { supabase } from '@gestor/shared/lib/supabase';
import logger from '@gestor/shared/lib/logger';

export const AutomationManager = {
    async evaluateStockRules(sku: string, currentStock: number) {
        logger.info({ sku, currentStock }, 'Evaluando reglas de automatización de stock');

        // 1. Pausado/Activado automático
        if (currentStock <= 0) {
            await this.enqueueMarketplaceAction(sku, 'pause');
        } else if (currentStock > 0) {
            await this.enqueueMarketplaceAction(sku, 'activate');
        }

        // 2. Generación de alertas
        await this.checkAlertRules(sku, currentStock);

        // 3. Cascada a Kits/Bundles dependientes
        await this.evaluateDependentBundles(sku);
    },

    async evaluateDependentBundles(componentSku: string) {
        // Encontrar todos los bundles que contienen este componente
        const { data: bundles } = await supabase
            .from('bundle_components')
            .select('bundle_sku')
            .eq('component_sku', componentSku);

        if (!bundles || bundles.length === 0) return;

        logger.info({ componentSku, bundleCount: bundles.length }, 'Disparando cálculo en cascada para Bundles');

        const bundleSkus = bundles.map((b: any) => b.bundle_sku);

        // Encontrar todos los mapeos de esos bundles en Marketplaces para actualizar su stock
        const { data: mappings } = await supabase
            .from('sku_marketplace_mapping')
            .select('sku, marketplace_id, external_item_id')
            .in('sku', bundleSkus);

        if (!mappings || mappings.length === 0) return;

        const jobsToInsert = mappings.map((mapping: any) => ({
            type: 'sync_stock',
            payload: {
                sku: mapping.sku,
                marketplace_id: mapping.marketplace_id,
                external_item_id: mapping.external_item_id
            },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        }));

        await supabase.from('jobs').insert(jobsToInsert);
    },

    async checkAlertRules(sku: string, currentStock: number) {
        if (currentStock === 0) {
            await this.createAlert('critical', 'low_stock', `STOCK AGOTADO: El producto ${sku} se ha quedado sin existencias.`, sku);
        } else if (currentStock <= 3) {
            await this.createAlert('warning', 'low_stock', `Stock crítico: Solo quedan ${currentStock} unidades del producto ${sku}.`, sku);
        }
    },

    async createAlert(level: 'info' | 'warning' | 'critical', type: string, message: string, sku?: string) {
        // Evitar duplicados recientes para la misma alerta (simplificado)
        const { count } = await supabase
            .from('system_alerts')
            .select('*', { count: 'exact', head: true })
            .eq('sku', sku || '')
            .eq('type', type)
            .eq('is_resolved', false);

        if (count && count > 0) return;

        logger.warn({ sku, level, message }, 'Generando alerta de sistema');

        await supabase.from('system_alerts').insert({
            level,
            type,
            message,
            sku,
            is_resolved: false
        });
    },

    async enqueueMarketplaceAction(sku: string, action: 'pause' | 'activate') {
        // Buscar todos los mapeos de este SKU
        const { data: mappings } = await supabase
            .from('sku_marketplace_mapping')
            .select('marketplace_id, external_item_id, sync_status')
            .eq('sku', sku);

        if (!mappings || mappings.length === 0) return;

        for (const mapping of mappings) {
            // Evitar encolar si ya está en el estado deseado (simplificado)
            if (action === 'pause' && mapping.sync_status === 'paused') continue;
            if (action === 'activate' && mapping.sync_status === 'active') continue;

            logger.info({ sku, action, marketplace: mapping.marketplace_id }, 'Encolando acción automática');

            await supabase.from('jobs').insert({
                type: action === 'pause' ? 'pause_listing' : 'activate_listing',
                payload: {
                    sku,
                    marketplace_id: mapping.marketplace_id,
                    external_item_id: mapping.external_item_id
                },
                status: 'pending',
                scheduled_at: new Date().toISOString()
            });
        }
    }
};
