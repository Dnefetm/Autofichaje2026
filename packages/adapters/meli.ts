import axios from 'axios';
import { MarketplaceAdapter, MarketplaceCapabilities } from './interface';
import { SKU } from '@gestor/shared';
import { supabase } from '@gestor/shared/lib/supabase';
import { checkRateLimit } from '@gestor/shared/lib/rate-limiter';
import logger from '@gestor/shared/lib/logger';
import { decrypt, encrypt } from '@gestor/shared';

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
            .select('access_token, refresh_token, expires_at')
            .eq('marketplace_id', accountId)
            .single();

        if (error || !data) {
            throw new Error(`No se pudo obtener el access_token para la cuenta ${accountId}`);
        }

        const expiresAt = new Date(data.expires_at).valueOf();
        const now = Date.now();
        const marginMs = 5 * 60 * 1000; // 5 minutos de seguridad

        if (now >= expiresAt - marginMs) {
            logger.info({ accountId }, 'El token de MeLi ha expirado (o está a punto). Ejecutando auto-refresh...');
            try {
                await this.refreshToken(accountId);

                // Si el refresh fue exitoso, traemos la nueva info actualizada de la BD
                const { data: newData, error: newError } = await supabase
                    .from('marketplace_tokens')
                    .select('access_token')
                    .eq('marketplace_id', accountId)
                    .single();

                if (newError || !newData) throw newError;
                return decrypt(newData.access_token);
            } catch (err) {
                logger.error({ accountId, err }, 'Fallo crítico al intentar renovar el token automáticamente');
                throw new Error(`Token expirado y no se pudo renovar: ${accountId}`);
            }
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
        let scrollId: string | undefined = undefined;
        let hasMore = true;

        try {
            // Obtener el user_id de MeLi
            const meResponse = await axios.get('https://api.mercadolibre.com/users/me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const userId = meResponse.data.id;

            // Búsqueda de items del usuario con iteración (Scroll / Paginación)
            const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search`;

            while (hasMore) {
                // Respetar Rate Limits antes de cada página
                await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 1);

                const params: any = { status: 'active', limit: 100, search_type: 'scan' };
                if (scrollId) {
                    params.scroll_id = scrollId;
                }

                const response = await axios.get(searchUrl, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params
                });

                const results = response.data.results || [];

                if (results.length > 0) {
                    itemIds = itemIds.concat(results);
                }

                // MeLi API documentation states scroll_id changes/remains and we must stop when results are empty.
                if (response.data.scroll_id && results.length > 0) {
                    scrollId = response.data.scroll_id;
                } else {
                    hasMore = false;
                }
            }

            logger.info({ accountId, itemCount: itemIds.length }, 'Finalizada extracción paginada de items MeLi');
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

            // 2. Inicializar inventario solo si NO existe (Debe ir ANTES del mapeo por FK). 
            // NUNCA sobrescribir con el stock de MeLi aquí, proteger la bodega física (Audit Phase 1).
            const { error: invError } = await supabase.rpc('safe_initialize_inventory', { sku_code: skuString });

            // Alternativa si no queremos crear RPC: intentamos insertar un registro con stock 0 ignorando conflictos
            // Esto garantiza que el FK mapping nunca falle, pero tampoco destruye datos reales
            const { error: insertError } = await supabase.from('inventory_snapshot')
                .insert({ sku: skuString, physical_stock: 0 });
            // Ignoramos insertError deliberadamente. Si falla (usualmente por UNIQUE constraint),
            // significa que el inventario real ya existe y es intocable.

            // 3. Crear el mapeo SKU <-> Marketplace
            const { error: mapError } = await supabase.from('sku_marketplace_mapping').upsert({
                sku: skuString,
                marketplace_id: accountId,
                external_item_id: item.id,
                sync_status: 'active',
                last_sync_at: new Date().toISOString()
            }, { onConflict: 'marketplace_id,external_item_id,external_variation_id' });

            if (mapError) throw mapError;

            logger.info({ sku: skuString, itemId: item.id }, 'Mapeo sincronizado con MeLi (Inventario Físico protegido)');

        } catch (error: any) {
            logger.error({ itemId, error: error.response?.data || error.message }, 'Error al sincronizar mapeo de MeLi');
        }
    }

    async getRecentOrders(accountId: string, since: Date): Promise<any[]> {
        // FIXME: Implement real logic for getRecentOrders when orders sync is built
        return [];
    }

    async refreshToken(accountId: string): Promise<void> {
        // Extraemos el refresh_token
        const { data, error } = await supabase
            .from('marketplace_tokens')
            .select('refresh_token')
            .eq('marketplace_id', accountId)
            .single();

        if (error || !data || !data.refresh_token) {
            throw new Error(`No hay refresh_token guardado para la cuenta ${accountId}`);
        }

        const decryptedRefresh = decrypt(data.refresh_token);

        // Disparamos contra MeLi
        try {
            const url = 'https://api.mercadolibre.com/oauth/token';
            const payload = new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: process.env.MELI_CLIENT_ID || '',
                client_secret: process.env.MELI_CLIENT_SECRET || '',
                refresh_token: decryptedRefresh
            });

            const response = await axios.post(url, payload.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
            });

            const creds = response.data;
            const new_access_token = creds.access_token;
            const new_refresh_token = creds.refresh_token; // A veces el refresh_token rota, hay que guardarlo
            const expires_in = creds.expires_in;

            const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

            // Guardar nuevos tokens encriptados
            const { error: upsertError } = await supabase
                .from('marketplace_tokens')
                .update({
                    access_token: encrypt(new_access_token),
                    refresh_token: encrypt(new_refresh_token),
                    expires_at: expires_at,
                    updated_at: new Date().toISOString()
                })
                .eq('marketplace_id', accountId);

            if (upsertError) throw upsertError;

            logger.info({ accountId }, 'Token de acceso MeLi renovado y encriptado exitosamente en BD.');
        } catch (oauthErr: any) {
            logger.error({ accountId, error: oauthErr.response?.data || oauthErr.message }, 'Fallo en la comunicación con MeLi /oauth/token');
            throw oauthErr;
        }
    }
}
