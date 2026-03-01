import axios from 'axios';
import { MarketplaceAdapter, MarketplaceCapabilities } from './interface';
import { SKU } from '@gestor/shared';
import { supabase } from '@gestor/shared/lib/supabase';
import { checkRateLimit } from '@gestor/shared/lib/rate-limiter';
import logger from '@gestor/shared/lib/logger';
import { decrypt } from '@gestor/shared';

export class MeliAdapter implements MarketplaceAdapter {
    readonly capabilities: MarketplaceCapabilities = {
        supportsBulkStock: false,
        supportsBulkPrice: false,
        supportsWebhooks: true,
        maxStockUpdateRate: 10,
    };

    private async getAccessToken(accountId: string): Promise<string> {
        const { data, error } = await supabase
            .from('marketplace_tokens')
            .select('access_token')
            .eq('marketplace_id', accountId)
            .single();

        if (error || !data) {
            throw new Error(`No se pudo obtener el access_token para la cuenta ${accountId}`);
        }

        return decrypt(data.access_token);
    }

    async updateStock(accountId: string, items: Array<{ itemId: string; variationId?: string; quantity: number }>): Promise<any> {
        const accessToken = await this.getAccessToken(accountId);
        const results = [];

        for (const item of items) {
            // Respetar Rate Limit (10 req/seg)
            const canProceed = await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 1);
            if (!canProceed) {
                throw new Error(`Rate limit excedido para la cuenta ${accountId} en Mercado Libre`);
            }

            try {
                const url = `https://api.mercadolibre.com/items/${item.itemId}`;
                const body = item.variationId
                    ? { variations: [{ id: item.variationId, available_quantity: item.quantity }] }
                    : { available_quantity: item.quantity };

                const response = await axios.put(url, body, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });

                results.push({ itemId: item.itemId, status: 'success', data: response.data });
            } catch (error: any) {
                logger.error({ itemId: item.itemId, error: error.response?.data || error.message }, 'Error al actualizar stock en MeLi');
                results.push({ itemId: item.itemId, status: 'error', error: error.response?.data || error.message });
            }
        }

        return results;
    }

    async updatePrice(accountId: string, items: Array<{ itemId: string; variationId?: string; price: number }>): Promise<any> {
        const accessToken = await this.getAccessToken(accountId);
        const results = [];

        for (const item of items) {
            await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 1);

            try {
                const url = `https://api.mercadolibre.com/items/${item.itemId}`;
                const body = item.variationId
                    ? { variations: [{ id: item.variationId, price: item.price }] }
                    : { price: item.price };

                const response = await axios.put(url, body, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });

                results.push({ itemId: item.itemId, status: 'success', data: response.data });
            } catch (error: any) {
                logger.error({ itemId: item.itemId, error: error.response?.data || error.message }, 'Error al actualizar precio en MeLi');
                results.push({ itemId: item.itemId, status: 'error', error: error.response?.data || error.message });
            }
        }

        return results;
    }

    async pauseListing(accountId: string, itemId: string): Promise<void> {
        const accessToken = await this.getAccessToken(accountId);
        await axios.put(`https://api.mercadolibre.com/items/${itemId}`, { status: 'paused' }, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
    }

    async activateListing(accountId: string, itemId: string): Promise<void> {
        const accessToken = await this.getAccessToken(accountId);
        await axios.put(`https://api.mercadolibre.com/items/${itemId}`, { status: 'active' }, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
    }

    async getAccountItems(accountId: string): Promise<string[]> {
        const accessToken = await this.getAccessToken(accountId);
        let itemIds: string[] = [];
        let scrollId: string | null = null;

        try {
            // Obtener el user_id de MeLi
            const meResponse = await axios.get('https://api.mercadolibre.com/users/me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const userId = meResponse.data.id;

            // Búsqueda de items del usuario
            const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search`;
            const response = await axios.get(searchUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { status: 'active', limit: 50 }
            });

            itemIds = response.data.results || [];
            return itemIds;
        } catch (error: any) {
            logger.error({ accountId, error: error.response?.data || error.message }, 'Error al obtener items de la cuenta MeLi');
            throw error;
        }
    }

    async getStock(accountId: string, itemId: string, variationId?: string): Promise<number> {
        const accessToken = await this.getAccessToken(accountId);

        try {
            const url = `https://api.mercadolibre.com/items/${itemId}`;
            const response = await axios.get(url, { headers: { Authorization: `Bearer ${accessToken}` } });

            if (variationId && response.data.variations) {
                const variation = response.data.variations.find((v: any) => v.id.toString() === variationId.toString());
                return variation ? variation.available_quantity : 0;
            }
            return response.data.available_quantity || 0;
        } catch (error: any) {
            logger.error({ accountId, itemId, error: error.response?.data || error.message }, 'Error obteniendo stock en MeLi');
            return 0;
        }
    }

    async syncCatalogItem(accountId: string, itemId: string): Promise<void> {
        const accessToken = await this.getAccessToken(accountId);

        try {
            const response = await axios.get(`https://api.mercadolibre.com/items/${itemId}`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            const item = response.data;
            const skuString = item.seller_custom_field || item.id;

            // 1. Crear/Actualizar el SKU en el catálogo maestro
            const { error: skuError } = await supabase.from('skus').upsert({
                sku: skuString,
                name: item.title,
                images: item.pictures?.map((p: any) => p.url) || [],
                description: item.descriptions?.[0]?.id || '', // Habría que hacer un GET extra para el texto
                is_active: true,
                updated_at: new Date().toISOString()
            });

            if (skuError) throw skuError;

            // 2. Crear el mapeo SKU <-> Marketplace
            const { error: mapError } = await supabase.from('sku_marketplace_mapping').upsert({
                sku: skuString,
                marketplace_id: accountId,
                external_item_id: item.id,
                sync_status: 'active',
                last_sync_at: new Date().toISOString()
            });

            if (mapError) throw mapError;

            // 3. Inicializar inventario si no existe
            await supabase.from('inventory_snapshot').upsert({
                sku: skuString,
                physical_stock: item.available_quantity,
                updated_at: new Date().toISOString()
            }, { onConflict: 'sku' });

            logger.info({ sku: skuString, itemId: item.id }, 'Item sincronizado con éxito desde MeLi');

        } catch (error: any) {
            logger.error({ itemId, error: error.response?.data || error.message }, 'Error al sincronizar item individual de MeLi');
        }
    }

    async getRecentOrders(accountId: string, since: Date): Promise<any[]> {
        // FIXME: Implement real logic for getRecentOrders when orders sync is built
        return [];
    }

    async refreshToken(accountId: string): Promise<void> {
        // Implementación directa si se requiere refresco manual
    }
}
