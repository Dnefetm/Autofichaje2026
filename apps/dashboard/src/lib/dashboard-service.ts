import { supabase } from '@/lib/supabase';
import { Articulo, Job } from '@gestor/shared';
import { dispatchWorker } from './dispatch-worker';

export const dashboardService = {
    async getArticulos() {
        const { data, error } = await supabase
            .from('articulos')
            .select('*, inventory_snapshot(physical_stock), marketplace_prices(sale_price)')
            .limit(50);

        if (error) throw error;
        return data;
    },

    async triggerStockUpdate(sku: string, newStock: number, marketplaceId?: string) {
        // 1. UPSERT inmediato en inventory_snapshot — stock local independiente de MeLi
        const { error: snapshotError } = await supabase
            .from('inventory_snapshot')
            .upsert({
                sku,
                physical_stock: newStock,
                updated_at: new Date().toISOString()
            }, { onConflict: 'sku' });

        if (snapshotError) {
            console.error('Error writing inventory_snapshot:', snapshotError);
            throw snapshotError;
        }

        // 2. Deduplicación: si ya hay un job pending para este SKU, actualizar en vez de duplicar
        const { data: existing } = await supabase
            .from('jobs')
            .select('id')
            .eq('type', 'sync_stock')
            .eq('status', 'pending')
            .contains('payload', { sku })
            .limit(1)
            .maybeSingle();

        if (existing) {
            const { error } = await supabase.from('jobs').update({
                payload: { sku, newStock, marketplace_id: marketplaceId },
                scheduled_at: new Date().toISOString()
            }).eq('id', existing.id);
            if (error) throw error;
            await dispatchWorker(); // V31: trigger worker on-demand
            return existing;
        }

        // 3. No hay duplicado: insertar nuevo job para sync a MeLi
        const { data, error } = await supabase.from('jobs').insert({
            type: 'sync_stock',
            payload: { sku, newStock, marketplace_id: marketplaceId },
            status: 'pending',
            scheduled_at: new Date().toISOString()
        });
        if (error) throw error;
        await dispatchWorker(); // V31: trigger worker on-demand
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
        await dispatchWorker(); // V31: trigger worker on-demand
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
            .eq('acknowledged', false)
            .order('created_at', { ascending: false })
            .limit(5);

        if (error) throw error;
        return data;
    },

    async searchArticulos(query: string) {
        const { data, error } = await supabase
            .from('articulos')
            .select('articulo_id, nombre, imagenes')
            .ilike('articulo_id', `%${query}%`)
            .limit(10);

        if (error) throw error;
        return data;
    },

    async getBundleComponents(bundleSku: string) {
        const { data, error } = await supabase
            .from('bundle_components')
            .select('*, articulos!bundle_components_component_sku_fkey(nombre, imagenes)')
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

        // 3. Encolar un trabajo para recalcular el stock del bundle (con deduplicación)
        const { data: existingJob } = await supabase
            .from('jobs')
            .select('id')
            .eq('type', 'sync_stock')
            .eq('status', 'pending')
            .contains('payload', { sku: bundleSku })
            .limit(1)
            .maybeSingle();

        if (!existingJob) {
            await supabase.from('jobs').insert({
                type: 'sync_stock',
                payload: { sku: bundleSku },
                status: 'pending',
                scheduled_at: new Date().toISOString()
            });
        }
        await dispatchWorker(); // V31: trigger worker on-demand
    }
};
