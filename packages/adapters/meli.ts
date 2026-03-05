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
        let offset = 0;
        const limit = 50;
        let hasMore = true;

        try {
            // Obtener el user_id de MeLi
            const meResponse = await axios.get('https://api.mercadolibre.com/users/me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const userId = meResponse.data.id;

            // Búsqueda de items del usuario con iteración (Offset / Paginación)
            const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search`;

            while (hasMore) {
                // Respetar Rate Limits antes de cada página
                await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 1);

                const response = await axios.get(searchUrl, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    params: { offset, limit }
                });

                const results = response.data.results || [];

                if (results.length > 0) {
                    itemIds = itemIds.concat(results);
                    offset += limit;
                }

                // Si la API devuelve menos items que el límite, hemos llegado al final.
                if (results.length < limit || response.data.paging?.total <= offset) {
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

            // 1. Insertar o actualizar la Vitrina en publicaciones_externas (Aislado del inventario físico)
            const { error: pubError } = await supabase.from('publicaciones_externas').upsert({
                marketplace_id: accountId,
                external_item_id: item.id,
                titulo: item.title,
                precio_venta: item.price,
                stock_publicado: item.available_quantity,
                status_externo: item.status,
                url_imagen: item.pictures?.[0]?.url || item.thumbnail,
                permalink: item.permalink,
                actualizado_el: new Date().toISOString()
            }, { onConflict: 'marketplace_id,external_item_id,external_variation_id' });

            if (pubError) throw pubError;

            logger.info({ itemId: item.id }, 'Publicación de MeLi almacenada en el Catálogo Virtual');

        } catch (error: any) {
            logger.error({ itemId, error: error.response?.data || error.message }, 'Error al sincronizar publicación de MeLi');
        }
    }

    // --- NUEVA FUNCIÓN SERVERLESS: BATCH SYNC ---
    async syncCatalogBatch(accountId: string, itemIds: string[]): Promise<number> {
        if (itemIds.length === 0) return 0;
        const accessToken = await this.getAccessToken(accountId);

        try {
            // MeLi permite máximo 20 IDs en MultiGET /items?ids=
            const CHUNK_SIZE = 20;
            const allResults: any[] = [];

            for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
                const chunk = itemIds.slice(i, i + CHUNK_SIZE);
                const idsParam = chunk.join(',');

                await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 1);

                const response = await axios.get(`https://api.mercadolibre.com/items?ids=${idsParam}`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });

                allResults.push(...response.data);
            }

            const itemsPayload = allResults
                .filter((res: any) => res.code === 200 && res.body)
                .map((res: any) => {
                    const item = res.body;
                    // DEUDA TÉCNICA: Items con variaciones (tallas/colores) se guardan como una sola fila
                    // con variation_id '0'. El stock y precio mostrado es el del item padre, no de cada
                    // variación individual. Para manejar variaciones real, iterar item.variations[]
                    // y crear una fila por cada una.
                    return {
                        marketplace_id: accountId,
                        external_item_id: item.id,
                        external_variation_id: '0',
                        titulo: item.title,
                        precio_venta: item.price,
                        stock_publicado: item.available_quantity,
                        status_externo: item.status,
                        url_imagen: item.pictures?.[0]?.url || item.thumbnail,
                        permalink: item.permalink,
                        // Nota: creado_el y created_at son columnas legacy, no se usan en lógica de negocio
                        actualizado_el: new Date().toISOString()
                    };
                });

            if (itemsPayload.length === 0) return 0;

            const { error: pubError } = await supabase.from('publicaciones_externas').upsert(
                itemsPayload,
                { onConflict: 'marketplace_id,external_item_id,external_variation_id' }
            );

            if (pubError) throw pubError;

            logger.info({ accountId, synced_count: itemsPayload.length }, 'Bloque de Publicaciones de MeLi almacenadas (Batch)');
            return itemsPayload.length;
        } catch (error: any) {
            logger.error({ accountId, error: error.response?.data || error.message }, 'Error masivo al sincronizar publicaciones de MeLi');
            return 0;
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
