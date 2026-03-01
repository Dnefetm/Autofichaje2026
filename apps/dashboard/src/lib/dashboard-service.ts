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
    }
};
