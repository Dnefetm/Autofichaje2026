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

        // Encontrar publicaciones mapeadas a esos bundles via tabla puente
        const { data: mappings } = await supabase
            .from('mapeo_publicacion_articulo')
            .select(`
                articulo_id,
                publicacion_id,
                publicaciones_externas!inner (
                    id, marketplace_id, external_item_id, es_fuente_stock
                )
            `)
            .in('articulo_id', bundleSkus);

        if (!mappings || mappings.length === 0) return;

        // Solo encolar sync para publicaciones fuente de stock
        const fuentesStock = mappings.filter((m: any) => m.publicaciones_externas?.es_fuente_stock === true);

        // Deduplicación: no crear jobs para publicaciones que ya tienen uno pending
        const { data: existingJobs } = await supabase
            .from('jobs')
            .select('payload')
            .eq('type', 'sync_stock_mapped')
            .eq('status', 'pending');
        const pendingPubIds = new Set((existingJobs || []).map((j: any) => j.payload?.publicacion_id));

        const jobsToInsert = fuentesStock
            .filter((m: any) => !pendingPubIds.has(m.publicaciones_externas.id))
            .map((mapping: any) => ({
                type: 'sync_stock_mapped',
                payload: {
                    publicacion_id: mapping.publicaciones_externas.id
                },
                status: 'pending',
                scheduled_at: new Date().toISOString()
            }));

        if (jobsToInsert.length > 0) {
            await supabase.from('jobs').insert(jobsToInsert);
        }
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
        // Buscar publicaciones mapeadas a este artículo via tabla puente
        const { data: mappings } = await supabase
            .from('mapeo_publicacion_articulo')
            .select(`
                publicaciones_externas!inner (
                    id, marketplace_id, external_item_id, es_fuente_stock, status_externo
                )
            `)
            .eq('articulo_id', sku);

        if (!mappings || mappings.length === 0) return;

        for (const mapping of mappings) {
            const pub = (mapping as any).publicaciones_externas;
            if (!pub?.es_fuente_stock) continue;

            // Evitar encolar si ya está en el estado deseado
            if (action === 'pause' && pub.status_externo === 'paused') continue;
            if (action === 'activate' && pub.status_externo === 'active') continue;

            logger.info({ sku, action, marketplace: pub.marketplace_id }, 'Encolando acción automática');

            await supabase.from('jobs').insert({
                type: action === 'pause' ? 'pause_listing' : 'activate_listing',
                payload: {
                    marketplace_id: pub.marketplace_id,
                    external_item_id: pub.external_item_id
                },
                status: 'pending',
                scheduled_at: new Date().toISOString()
            });
        }
    }
};
