import axios from 'axios';
import { MarketplaceAdapter, MarketplaceCapabilities } from './interface';
import { SKU } from '@gestor/shared';
import { supabase } from '@gestor/shared/lib/supabase';
import { checkRateLimit } from '@gestor/shared/lib/rate-limiter';
import logger from '@gestor/shared/lib/logger';
import { decrypt, encrypt } from '@gestor/shared';

/**
 * Clasifica el tipo de publicación de MeLi a partir de los datos de la API.
 * Tipos: 'tradicional' | 'catalogo' | 'tradicional_derivada' | 'catalogo_derivada'
 */
function clasificarPublicacion(item: any): {
    tipo_publicacion: string;
    id_publicacion_padre: string | null;
    es_fuente_stock: boolean;
    id_producto_catalogo: string | null;
} {
    const isCatalog = item.catalog_listing === true ||
        item.listing_type_id === 'gold_product_page';
    const hasParent = !!item.parent_item_id;

    let tipo_publicacion = 'tradicional';
    if (isCatalog && hasParent) {
        tipo_publicacion = 'catalogo_derivada';
    } else if (isCatalog) {
        tipo_publicacion = 'catalogo';
    } else if (hasParent) {
        tipo_publicacion = 'tradicional_derivada';
    }
    // else: 'tradicional' (padre) — default

    return {
        tipo_publicacion,
        id_publicacion_padre: item.parent_item_id || null,
        es_fuente_stock: tipo_publicacion === 'tradicional', // Solo padre tradicional
        id_producto_catalogo: item.catalog_product_id || null,
    };
}

export class MeliAdapter implements MarketplaceAdapter {
    readonly capabilities: MarketplaceCapabilities = {
        supportsBulkStock: false,
        supportsBulkPrice: false,
        supportsWebhooks: true,
        maxStockUpdateRate: 50, // 50 req / 5 seg — MeLi permite más, el bottleneck real es su API response time
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
            // Respetar Rate Limit (50 req/5seg)
            const canProceed = await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 5);
            if (!canProceed) {
                // Skipear este item, no abortar todo el batch
                results.push({ itemId: item.itemId, status: 'error', error: `Rate limit excedido para cuenta ${accountId}` });
                continue;
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
            await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 5);

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
                await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 5);

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

            // Clasificar tipo de publicación (Tradicional, Catálogo, Derivada, etc.)
            const clasificacion = clasificarPublicacion(item);

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
                tipo_publicacion: clasificacion.tipo_publicacion,
                id_publicacion_padre: clasificacion.id_publicacion_padre,
                es_fuente_stock: clasificacion.es_fuente_stock,
                id_producto_catalogo: clasificacion.id_producto_catalogo,
                actualizado_el: new Date().toISOString()
            }, { onConflict: 'marketplace_id,external_item_id,external_variation_id' });

            if (pubError) throw pubError;

            logger.info({ itemId: item.id, tipo: clasificacion.tipo_publicacion }, 'Publicación de MeLi almacenada en el Catálogo Virtual');

        } catch (error: any) {
            logger.error({ itemId, error: error.response?.data || error.message }, 'Error al sincronizar publicación de MeLi');
        }
    }

    // --- NUEVA FUNCIÓN SERVERLESS: BATCH SYNC ---
    async syncCatalogBatch(accountId: string, itemIds: string[]): Promise<number> {
        if (itemIds.length === 0) return 0;
        const accessToken = await this.getAccessToken(accountId);
        return this.syncCatalogBatchFast(accountId, accessToken, itemIds);
    }

    // --- VERSIÓN OPTIMIZADA: recibe token, multiGETs en paralelo ---
    async syncCatalogBatchFast(accountId: string, accessToken: string, itemIds: string[]): Promise<number> {
        if (itemIds.length === 0) return 0;

        try {
            // MeLi permite máximo 20 IDs en MultiGET — paralelizar todos los chunks
            const CHUNK_SIZE = 20;
            const chunks: string[][] = [];
            for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
                chunks.push(itemIds.slice(i, i + CHUNK_SIZE));
            }

            // Disparar todos los multiGETs en paralelo (Promise.all)
            const chunkResponses = await Promise.all(
                chunks.map(chunk => {
                    const idsParam = chunk.join(',');
                    return axios.get(`https://api.mercadolibre.com/items?ids=${idsParam}&include_attributes=all`, {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    });
                })
            );

            const allResults = chunkResponses.flatMap(r => r.data);

            const itemsPayload = allResults
                .filter((res: any) => res.code === 200 && res.body)
                .flatMap((res: any) => {
                    const item = res.body;
                    const clasificacion = clasificarPublicacion(item);

                    // Campos comunes a todas las filas de este ítem (o variaciones)
                    const base = {
                        marketplace_id: accountId,
                        external_item_id: item.id,
                        titulo: item.title,
                        precio_venta: item.price,
                        stock_publicado: item.available_quantity,
                        status_externo: item.status,
                        url_imagen: item.pictures?.[0]?.url || item.thumbnail,
                        permalink: item.permalink,
                        tipo_publicacion: clasificacion.tipo_publicacion,
                        id_publicacion_padre: clasificacion.id_publicacion_padre,
                        es_fuente_stock: clasificacion.es_fuente_stock,
                        id_producto_catalogo: clasificacion.id_producto_catalogo,
                        actualizado_el: new Date().toISOString(),
                        // --- Campos enriquecidos V17 ---
                        sold_quantity: item.sold_quantity || 0,
                        listing_type_id: item.listing_type_id || null,
                        logistic_type: item.shipping?.logistic_type || null,
                        free_shipping: item.shipping?.free_shipping ?? false,
                        health: item.health ?? null,
                        tags: item.tags || [],
                        original_price: item.original_price ?? null,
                        category_id: item.category_id || null,
                        domain_id: item.domain_id || null,
                        condition: item.condition || null,
                        brand: item.attributes?.find((a: any) => a.id === 'BRAND')?.value_name || null,
                        seller_sku: item.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name || null,
                        sub_status: item.sub_status || [],
                        channels: item.channels || [],
                        meli_created_at: item.date_created || null,
                        meli_updated_at: item.last_updated || null,
                        deal_ids: item.deal_ids || [],
                        warranty: item.warranty || null,
                        currency_id: item.currency_id || null,
                        initial_quantity: item.initial_quantity ?? null,
                        // --- V20: Bundle flag ---
                        es_bundle: (item.tags || []).includes('bundle'),
                        // --- V23: Fase 1 — campos adicionales del multiGET ---
                        shipping_tags:       item.shipping?.tags || [],
                        shipping_dimensions: item.shipping?.dimensions || null,
                        inventory_id:        item.inventory_id || null,
                        video_id:            item.video_id || null,
                        base_price:          item.base_price ?? null,
                        automatic_relist:    item.automatic_relist ?? false,
                        buying_mode:         item.buying_mode || null,
                        // --- V24: Campos enriquecidos de atributos y envío ---
                        model:         item.attributes?.find((a: any) => a.id === 'MODEL')?.value_name || null,
                        ean:           item.attributes?.find((a: any) => a.id === 'EAN')?.value_name || null,
                        gtin:          item.attributes?.find((a: any) => a.id === 'GTIN')?.value_name || null,
                        upc:           item.attributes?.find((a: any) => a.id === 'UPC')?.value_name || null,
                        pictures_count: item.pictures?.length || 0,
                        shipping_mode:  item.shipping?.mode || null,
                        local_pick_up:  item.shipping?.local_pick_up ?? false,
                    };

                    // Items con variaciones:
                    // • Fila padre (variation_id='0'): datos de nivel item (brand, SKU, stock tot., precio base)
                    // • Filas de variación: datos individuales (stock/precio/attrs por variante)
                    if (item.variations && item.variations.length > 0) {
                        const parentSellerSku = item.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name || null;
                        const parentRow = {
                            ...base,
                            external_variation_id: '0',
                            variation_attributes: null,
                            variation_picture_ids: null,
                            seller_custom_field: item.seller_custom_field || null,
                            seller_sku: parentSellerSku,
                        };
                        const variationRows = item.variations.map((variation: any) => ({
                            ...base,
                            external_variation_id: variation.id.toString(),
                            stock_publicado: variation.available_quantity ?? item.available_quantity,
                            precio_venta: variation.price ?? item.price,
                            // Atributos de diferenciación de la variante (COLOR, TALLA, etc.)
                            variation_attributes: variation.attribute_combinations?.length
                                ? variation.attribute_combinations
                                : null,
                            // Fotos específicas de la variante
                            variation_picture_ids: variation.picture_ids?.length
                                ? variation.picture_ids
                                : null,
                            // SKU específico de la variante:
                            // seller_custom_field = campo directo de la variante
                            // seller_sku = seller_custom_field → SELLER_SKU en attributes[] → SKU del padre → null
                            // (V25: con include_attributes=all, variation.attributes[] ya está disponible)
                            seller_custom_field: variation.seller_custom_field || null,
                            seller_sku: variation.seller_custom_field
                                || variation.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name
                                || parentSellerSku
                                || null,
                            // EAN/GTIN por variación (V25: desde attributes[], no desde base del ítem)
                            ean:  variation.attributes?.find((a: any) => a.id === 'EAN')?.value_name  || base.ean  || null,
                            gtin: variation.attributes?.find((a: any) => a.id === 'GTIN')?.value_name || base.gtin || null,
                        }));
                        return [parentRow, ...variationRows];
                    }

                    // Sin variaciones: fila única — campos de variante en NULL
                    return [{
                        ...base,
                        external_variation_id: '0',
                        variation_attributes: null,
                        variation_picture_ids: null,
                        seller_custom_field: item.seller_custom_field || null,
                    }];
                });

            if (itemsPayload.length === 0) return 0;

            // V21 — Enriquecer SKU de variaciones desde /items/{id}/variations
            // El multi-GET no retorna seller_custom_field confiablemente en variaciones.
            // Solo llamar para items cuyas variaciones NO tuvieron seller_custom_field.
            const itemsNeedingSkuFetch = allResults
                .filter((res: any) => res.code === 200 && res.body)
                .filter((res: any) => {
                    const item = res.body;
                    return item.variations?.length > 0 &&
                        item.variations.some((v: any) => !v.seller_custom_field); // V24 fix: some en vez de every
                })
                .map((res: any) => res.body.id);

            if (itemsNeedingSkuFetch.length > 0) {
                const CONCURRENCY = 20;
                // Agrupar en chunks para no superar rate limit
                for (let i = 0; i < itemsNeedingSkuFetch.length; i += CONCURRENCY) {
                    const chunk = itemsNeedingSkuFetch.slice(i, i + CONCURRENCY);
                    await Promise.all(chunk.map(async (itemId: string) => {
                        try {
                            const varResp = await axios.get(
                                `https://api.mercadolibre.com/items/${itemId}/variations`,
                                { headers: { Authorization: `Bearer ${accessToken}` } }
                            );
                            const varDetails: any[] = varResp.data;
                            // Construir mapa varId -> seller_custom_field
                            const skuByVarId = new Map<string, string | null>();
                            for (const vd of varDetails) {
                                const sku =
                                    vd.seller_custom_field ||
                                    vd.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name || // V25: attributes, NO attribute_combinations
                                    null;
                                skuByVarId.set(vd.id.toString(), sku);
                            }
                            // Parchear el itemsPayload ya construido
                            for (const row of itemsPayload) {
                                if (
                                    row.external_item_id === itemId &&
                                    row.external_variation_id !== '0'
                                ) {
                                    const sku = skuByVarId.get(row.external_variation_id) ?? null;
                                    if (sku) {
                                        row.seller_custom_field = sku;
                                        row.seller_sku = sku;
                                    }
                                    // V24: Extraer EAN/GTIN por variación si no viene del multiGET
                                    const varDetail = varDetails.find((vd: any) => vd.id.toString() === row.external_variation_id);
                                    if (varDetail) {
                                        const varEan = varDetail.attributes?.find((a: any) => a.id === 'EAN')?.value_name || null;
                                        const varGtin = varDetail.attributes?.find((a: any) => a.id === 'GTIN')?.value_name || null;
                                        if (varEan && !row.ean) row.ean = varEan;
                                        if (varGtin && !row.gtin) row.gtin = varGtin;
                                    }
                                }
                            }
                        } catch (varErr: any) {
                            logger.warn(
                                { itemId, error: varErr.message },
                                'No se pudo obtener SKU de variaciones — se usará campo del padre'
                            );
                        }
                    }));
                }
            }
            const { error: pubError } = await supabase.from('publicaciones_externas').upsert(
                itemsPayload,
                { onConflict: 'marketplace_id,external_item_id,external_variation_id' }
            );

            if (pubError) throw pubError;

            // V20: recalcular par_item_id para los items de este batch que tengan id_producto_catalogo
            const syncedItemIds = [...new Set(itemsPayload.map((r: any) => r.external_item_id))];
            if (syncedItemIds.length > 0) {
                // par_item_id RPC
                const { error: parError } = await supabase.rpc('recalcular_par_item_id', {
                    p_account_id: accountId,
                    p_item_ids: syncedItemIds,
                });
                if (parError) {
                    logger.warn({ accountId, error: parError.message }, 'par_item_id RPC no disponible — se actualizará en el próximo sync completo');
                }
                // V22: catalog_count RPC
                const { error: ccError } = await supabase.rpc('recalcular_catalog_count', {
                    p_account_id: accountId,
                    p_item_ids: syncedItemIds,
                });
                if (ccError) {
                    logger.warn({ accountId, error: ccError.message }, 'catalog_count RPC no disponible');
                }
                // V23: associated_count RPC
                const { error: acError } = await supabase.rpc('recalcular_associated_count', {
                    p_account_id: accountId,
                    p_item_ids: syncedItemIds,
                });
                if (acError) {
                    logger.warn({ accountId, error: acError.message }, 'associated_count RPC no disponible');
                }
            }

            logger.info({ accountId, synced_count: itemsPayload.length }, 'Batch Fast Sync completado');
            return itemsPayload.length;
        } catch (error: any) {
            logger.error({ accountId, error: error.response?.data || error.message }, 'Error en syncCatalogBatchFast');
            return 0;
        }
    }


    // ─────────────────────────────────────────────────────────────────────────
    // V27 — enrichCatalogBatch: comisiones + visitas + descripciones (separado del sync)
    // Se llama desde /api/sync/enrich — NO desde syncCatalogBatchFast
    // ─────────────────────────────────────────────────────────────────────────
    async enrichCatalogBatch(accountId: string, accessToken: string, itemIds: string[]): Promise<void> {
        const CONCURRENCY = 10;

        // ── Comisiones (paralelas, cacheadas por combinación) ────────────────
        try {
            // Obtener datos necesarios para calcular comisión
            const { data: rows } = await supabase
                .from('publicaciones_externas')
                .select('external_item_id, category_id, listing_type_id, logistic_type, shipping_mode, precio_venta')
                .eq('marketplace_id', accountId)
                .in('external_item_id', itemIds)
                .in('external_variation_id', ['0']); // solo filas padre

            const commissionCache = new Map<string, { pct: number | null; amount: number | null }>();

            // Extraer combinaciones únicas para minimizar llamadas a MeLi
            const uniqueCombos = [...new Map((rows || []).map((r: any) => {
                const priceBucket = Math.round((r.precio_venta || 0) / 100) * 100;
                const key = `${r.category_id}|${r.listing_type_id}|${r.logistic_type}|${priceBucket}`;
                return [key, r];
            })).values()];

            // Fetch paralelas en chunks de CONCURRENCY
            for (let i = 0; i < uniqueCombos.length; i += CONCURRENCY) {
                const chunk = uniqueCombos.slice(i, i + CONCURRENCY);
                await Promise.all(chunk.map(async (row: any) => {
                    const priceBucket = Math.round((row.precio_venta || 0) / 100) * 100;
                    const cacheKey = `${row.category_id}|${row.listing_type_id}|${row.logistic_type}|${priceBucket}`;
                    if (commissionCache.has(cacheKey)) return;
                    if (!row.category_id || !row.listing_type_id || !row.precio_venta) {
                        commissionCache.set(cacheKey, { pct: null, amount: null });
                        return;
                    }
                    try {
                        const params = new URLSearchParams({
                            price: String(row.precio_venta),
                            category_id: row.category_id,
                            listing_type_id: row.listing_type_id,
                        });
                        if (row.logistic_type) params.set('logistic_type', row.logistic_type);
                        if (row.shipping_mode) params.set('shipping_mode', row.shipping_mode);
                        const feeResp = await axios.get(
                            `https://api.mercadolibre.com/sites/MLM/listing_prices?${params.toString()}`,
                            { headers: { Authorization: `Bearer ${accessToken}` } }
                        );
                        const raw = feeResp.data;
                        const feeData = Array.isArray(raw) ? raw[0] : raw;
                        commissionCache.set(cacheKey, {
                            pct:    feeData?.sale_fee_details?.percentage_fee ?? null,
                            amount: feeData?.sale_fee_amount ?? null,
                        });
                    } catch {
                        commissionCache.set(cacheKey, { pct: null, amount: null });
                    }
                }));
            }

            // Aplicar comisiones calculadas
            for (const row of (rows || [])) {
                const priceBucket = Math.round((row.precio_venta || 0) / 100) * 100;
                const cacheKey = `${row.category_id}|${row.listing_type_id}|${row.logistic_type}|${priceBucket}`;
                const fee = commissionCache.get(cacheKey);
                if (fee && (fee.pct != null || fee.amount != null)) {
                    await supabase
                        .from('publicaciones_externas')
                        .update({ comision_porcentaje: fee.pct, comision_monto: fee.amount })
                        .eq('marketplace_id', accountId)
                        .eq('external_item_id', row.external_item_id)
                        .eq('external_variation_id', '0');
                }
            }
            logger.debug({ accountId, items: itemIds.length }, 'V27: comisiones enriquecidas');
        } catch (feeErr: any) {
            logger.warn({ accountId, error: feeErr.message }, 'V27: error en enriquecimiento de comisiones');
        }

        // ── Visitas 30d (/items/{id}/visits/time_window?last=30&unit=day) ───
        try {
            for (let i = 0; i < itemIds.length; i += CONCURRENCY) {
                const chunk = itemIds.slice(i, i + CONCURRENCY);
                await Promise.all(chunk.map(async (itemId: string) => {
                    try {
                        const visitResp = await axios.get(
                            `https://api.mercadolibre.com/items/${itemId}/visits/time_window?last=30&unit=day`,
                            { headers: { Authorization: `Bearer ${accessToken}` } }
                        );
                        const totalVisits = visitResp.data?.total_visits ?? 0;
                        await supabase
                            .from('publicaciones_externas')
                            .update({ visits_30d: totalVisits, visits_updated_at: new Date().toISOString() })
                            .eq('marketplace_id', accountId)
                            .eq('external_item_id', itemId);
                    } catch { /* item fallido — continuar */ }
                }));
            }
            logger.debug({ accountId, items: itemIds.length }, 'V27: visitas 30d enriquecidas');
        } catch (visitErr: any) {
            logger.warn({ accountId, error: visitErr.message }, 'V27: error en enriquecimiento de visitas');
        }

        // ── Descripciones (solo items sin descripción previa, máx 20) ────────
        try {
            const { data: withoutDesc } = await supabase
                .from('publicaciones_externas')
                .select('external_item_id')
                .eq('marketplace_id', accountId)
                .in('external_item_id', itemIds)
                .is('description_plain', null)
                .limit(50); // V28: subido de 20 a 50 para cubrir más items por relay

            for (let i = 0; i < (withoutDesc || []).length; i += CONCURRENCY) {
                const chunk = (withoutDesc || []).slice(i, i + CONCURRENCY);
                await Promise.all(chunk.map(async (row: any) => {
                    try {
                        const descResp = await axios.get(
                            `https://api.mercadolibre.com/items/${row.external_item_id}/description`,
                            { headers: { Authorization: `Bearer ${accessToken}` } }
                        );
                        const plain = descResp.data?.plain_text?.slice(0, 4000) || '';
                        if (plain) {
                            await supabase
                                .from('publicaciones_externas')
                                .update({ description_plain: plain })
                                .eq('marketplace_id', accountId)
                                .eq('external_item_id', row.external_item_id);
                        }
                    } catch { /* item sin descripción — continuar */ }
                }));
            }
            logger.debug({ accountId }, 'V27: descripciones enriquecidas');
        } catch (descErr: any) {
            logger.warn({ accountId, error: descErr.message }, 'V27: error en enriquecimiento de descripciones');
        }
    }

    async getRecentOrders(accountId: string, since: Date): Promise<any[]> {
        // FIXME: Implement real logic for getRecentOrders when orders sync is built
        return [];
    }

    async refreshToken(accountId: string): Promise<void> {
        // 1. Extraer refresh_token actual
        const { data, error } = await supabase
            .from('marketplace_tokens')
            .select('refresh_token')
            .eq('marketplace_id', accountId)
            .single();

        if (error || !data || !data.refresh_token) {
            throw new Error(`No hay refresh_token guardado para la cuenta ${accountId}`);
        }

        // 2. Leer credenciales POR CUENTA desde marketplace_configs.settings
        const { data: config } = await supabase
            .from('marketplace_configs')
            .select('settings')
            .eq('id', accountId)
            .single();

        const clientId = config?.settings?.client_id || process.env.MELI_CLIENT_ID || '';
        const clientSecret = config?.settings?.client_secret || process.env.MELI_CLIENT_SECRET || '';

        if (!clientId || !clientSecret) {
            throw new Error(`Faltan credenciales OAuth para la cuenta ${accountId}. Configura client_id/client_secret en marketplace_configs.settings o en las env vars.`);
        }

        const decryptedRefresh = decrypt(data.refresh_token);

        try {
            logger.info({ accountId }, 'Renovando token de Mercado Libre...');

            const url = 'https://api.mercadolibre.com/oauth/token';
            const payload = new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: clientId,
                client_secret: clientSecret,
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
            const new_refresh_token = creds.refresh_token;
            const expires_in = creds.expires_in;
            const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

            // Guardar AMBOS tokens (MeLi rota el refresh_token en cada uso)
            const { error: updateError } = await supabase
                .from('marketplace_tokens')
                .update({
                    access_token: encrypt(new_access_token),
                    refresh_token: encrypt(new_refresh_token),
                    expires_at: expires_at,
                    updated_at: new Date().toISOString()
                })
                .eq('marketplace_id', accountId);

            if (updateError) throw updateError;

            logger.info({ accountId }, 'Token de acceso MeLi renovado y encriptado exitosamente en BD.');
        } catch (oauthErr: any) {
            logger.error({ accountId, error: oauthErr.response?.data || oauthErr.message }, 'Fallo en la comunicación con MeLi /oauth/token');
            throw oauthErr;
        }
    }
}

