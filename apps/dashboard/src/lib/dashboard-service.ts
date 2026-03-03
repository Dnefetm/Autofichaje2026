import { supabase } from '@/lib/supabase';
import { SKU, Job } from '@gestor/shared';

export const dashboardService = {
    async getSKUs() {
        const { data, error } = await supabase
            .from('skus')
            .select('*, inventory_snapshot(physical_stock), marketplace_prices(sale_price)')
            .limit(50);

        if (error) throw error;
        return data;
    },

    async triggerStockUpdate(sku: string, newStock: number, marketplaceId: string) {
        // 1. Insertar el job en la cola
        const { data, error } = await supabase.from('jobs').insert({
            type: 'sync_stock',
            payload: {
                sku,
                newStock,
                marketplace_id: marketplaceId
            },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        });

        if (error) throw error;
        return data;
    },

    async triggerBulkPriceUpdate(skus: string[], operation: 'percentage' | 'fixed', value: number, marketplaceId: string) {
        const { data, error } = await supabase.from('jobs').insert({
            type: 'bulk_update_price',
            payload: {
                skus,
                operation,
                value,
                marketplace_id: marketplaceId
            },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        });

        if (error) throw error;
        return data;
    },

    async getMarketplaceConfigs() {
        const { data, error } = await supabase
            .from('marketplace_configs')
            .select('*')
            .eq('is_active', true);

        if (error) throw error;
        return data;
    },

    async getRecentJobs() {
        const { data, error } = await supabase
            .from('jobs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) throw error;
        return data;
    },

    async getActiveAlerts() {
        const { data, error } = await supabase
            .from('system_alerts')
            .select('*')
            .eq('is_resolved', false)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) throw error;
        return data;
    },

    async searchSKUs(query: string) {
        const { data, error } = await supabase
            .from('skus')
            .select('sku, name, images')
            .ilike('sku', `%${query}%`)
            .limit(10);
        if (error) throw error;
        return data;
    },

    async getBundleComponents(bundleSku: string) {
        const { data, error } = await supabase
            .from('bundle_components')
            .select('*, skus(name, images)')
            .eq('bundle_sku', bundleSku);
        if (error) throw error;
        return data;
    },

    async saveBundle(bundleSku: string, components: Array<{ component_sku: string, quantity: number }>) {
        // 1. Borrar componentes actuales
        await supabase.from('bundle_components').delete().eq('bundle_sku', bundleSku);

        // 2. Insertar nuevos componentes
        if (components.length > 0) {
            const mapped = components.map(c => ({
                bundle_sku: bundleSku,
                component_sku: c.component_sku,
                quantity: c.quantity
            }));
            const { error } = await supabase.from('bundle_components').insert(mapped);
            if (error) throw error;
        }

        // 3. Encolar un trabajo para recalcular el stock del bundle recién creado o editado
        await supabase.from('jobs').insert({
            type: 'sync_stock',
            payload: { sku: bundleSku },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        });
    }
};
