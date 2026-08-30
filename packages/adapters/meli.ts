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
        es_fuente_stock: tipo_publicacion === 'tradicional' || tipo_publicacion === 'catalogo', // Tradicional + Catálogo directo (sin padre)
        id_producto_catalogo: item.catalog_product_id || null,
    };
}

// A2: Detecta SKUs que son articulo_id UUID legacy (exactamente 8 chars hexadecimales).
// Mismo patrón que esSkuBasura en fix-sku/route.ts
const SKU_BASURA_RE = /^[0-9a-f]{8}$/i;
function isSkuGarbage(sku: string | null | undefined): boolean {
    if (!sku) return false;
    return SKU_BASURA_RE.test(sku.trim());
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

    /**
     * getStockBatch — multiGET de stock para hasta N items.
     * Hace chunks de 20 IDs (límite de MeLi multiGET).
     * Retorna Map<external_item_id, available_quantity>.
     * Usado por reconciliation.ts para evitar 1 GET individual por publicación.
     */
    async getStockBatch(accountId: string, itemIds: string[]): Promise<Map<string, number>> {
        const result = new Map<string, number>();
        if (itemIds.length === 0) return result;

        const accessToken = await this.getAccessToken(accountId);
        const CHUNK_SIZE = 20;

        for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
            const chunk = itemIds.slice(i, i + CHUNK_SIZE);
            try {
                const resp = await axios.get(
                    `https://api.mercadolibre.com/items?ids=${chunk.join(',')}&attributes=id,available_quantity`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                for (const res of resp.data) {
                    if (res.code === 200 && res.body) {
                        result.set(res.body.id, res.body.available_quantity ?? 0);
                    } else {
                        // Item con error (deleted, paused sin datos, etc.) — no bloquear la reconciliación
                        logger.warn({ itemId: res.body?.id ?? '?', code: res.code }, 'getStockBatch: item con error en multiGET');
                    }
                }
            } catch (err: any) {
                logger.error({ accountId, chunk, error: err.message }, 'getStockBatch: error en chunk multiGET');
                // No lanzar — los items de este chunk quedarán sin entrada en el Map
                // y la reconciliación los salteará (no creará discrepancia falsa positiva)
            }
        }
        return result;
    }

    // B3: multiGET que retorna stock + status + sub_status en un solo request.
    // Reemplaza la necesidad de llamar getStockBatch + reconcileClosedItems por separado.
    async getStockAndStatusBatch(accountId: string, itemIds: string[]): Promise<Map<string, { qty: number; status: string; sub_status: string[] }>> {
        const result = new Map<string, { qty: number; status: string; sub_status: string[] }>();
        if (itemIds.length === 0) return result;

        const accessToken = await this.getAccessToken(accountId);
        const CHUNK_SIZE = 20;
        for (let i = 0; i < itemIds.length; i += CHUNK_SIZE) {
            const chunk = itemIds.slice(i, i + CHUNK_SIZE);
            try {
                const resp = await axios.get(
                    `https://api.mercadolibre.com/items?ids=${chunk.join(',')}&attributes=id,available_quantity,status,sub_status`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );
                for (const res of resp.data) {
                    if (res.code === 200 && res.body) {
                        result.set(res.body.id, {
                            qty: res.body.available_quantity ?? 0,
                            status: res.body.status ?? 'unknown',
                            sub_status: res.body.sub_status ?? [],
                        });
                    } else {
                        logger.warn({ itemId: res.body?.id ?? '?', code: res.code }, 'getStockAndStatusBatch: item con error en multiGET');
                    }
                }
            } catch (err: any) {
                logger.error({ accountId, chunk, error: err.message }, 'getStockAndStatusBatch: error en chunk multiGET');
            }
        }
        return result;
    }

    async syncCatalogItem(accountId: string, itemId: string): Promise<void> {
        const accessToken = await this.getAccessToken(accountId);
        try {
            logger.info({ accountId, itemId }, 'Iniciando syncCatalogItem (enrutado a syncCatalogBatchFast)');
            await this.syncCatalogBatchFast(accountId, accessToken, [itemId]);
        } catch (error: any) {
            logger.error({ itemId, error: error.response?.data || error.message }, 'Error al sincronizar publicación individual de MeLi');
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

                    // A2: Filtrar SELLER_SKU garbage antes de construir cualquier fila
                    const _rawItemSku = item.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name || null;
                    const _cleanItemSku = isSkuGarbage(_rawItemSku) ? null : _rawItemSku;

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
                        seller_sku: _cleanItemSku,
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
                        const parentSellerSku = _cleanItemSku; // ya filtrado arriba
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
                            seller_sku: (() => {
                                const raw = variation.seller_custom_field
                                    || variation.attributes?.find((a: any) => a.id === 'SELLER_SKU')?.value_name
                                    || _rawItemSku
                                    || null;
                                return isSkuGarbage(raw) ? null : raw;
                            })(),
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
            // -- Detección de transición fulfillment→otro (portada de b39de85) --
            // Leer logistic_type previo para todos los items del batch en 1 sola query.
            // Solo filas padre (external_variation_id='0') — son las únicas con logistic_type relevante.
            const batchItemIds = [...new Set(itemsPayload.map((p: any) => p.external_item_id))];
            const { data: existingPubs } = await supabase
                .from('publicaciones_externas')
                .select('id, external_item_id, logistic_type')
                .eq('marketplace_id', accountId)
                .eq('external_variation_id', '0')
                .in('external_item_id', batchItemIds);

            const existingMap = new Map(
                (existingPubs || []).map((p: any) => [p.external_item_id, { id: p.id, logistic_type: p.logistic_type }])
            );

            // -- Upsert batch --------------------------------------------------
            const { error: pubError } = await supabase.from('publicaciones_externas').upsert(
                itemsPayload,
                { onConflict: 'marketplace_id,external_item_id,external_variation_id' }
            );

            if (pubError) throw pubError;

            // -- Post-upsert: detectar transiciones fulfillment→otro -----------
            // Solo encola sync_stock si algún item cambió de fulfillment a otro tipo.
            const transitionedPubIds: string[] = [];
            for (const payload of itemsPayload) {
                if (payload.external_variation_id !== '0') continue; // solo filas padre
                const prev = existingMap.get(payload.external_item_id);
                if (prev?.logistic_type === 'fulfillment' && payload.logistic_type !== 'fulfillment') {
                    if (prev.id) transitionedPubIds.push(prev.id);
                }
            }

            if (transitionedPubIds.length > 0) {
                const { data: mappings } = await supabase
                    .from('mapeo_publicacion_articulo')
                    .select('articulo_id')
                    .in('publicacion_id', transitionedPubIds);

                const uniqueSkus = [...new Set((mappings || []).map((m: any) => m.articulo_id))];
                if (uniqueSkus.length > 0) {
                    await supabase.from('jobs').insert(
                        uniqueSkus.map((sku: string) => ({
                            type: 'sync_stock',
                            payload: { sku },
                            status: 'pending',
                            priority: 1,
                        }))
                    );
                    logger.info(
                        { accountId, transitions: transitionedPubIds.length, skus: uniqueSkus },
                        'Batch: transiciones fulfillment→otro detectadas, sync_stock encolados'
                    );
                }
            }



                    // V30: Promover catalogo_derivada huérfanas a fuente de stock (padre ausente en publicaciones_externas)
        // Esto cubre items de catálogo que fueron creados por MeLi sin publicación tradicional padre
        const derivadasEnBatch = itemsPayload
            .filter((r: any) => r.tipo_publicacion === 'catalogo_derivada' && r.id_publicacion_padre && r.external_variation_id === '0')
            .map((r: any) => r.external_item_id);

        if (derivadasEnBatch.length > 0) {
            // Buscar cuáles de esas derivadas NO tienen padre como fuente de stock
            const { data: padresFuente } = await supabase
                .from('publicaciones_externas')
                .select('external_item_id')
                .eq('marketplace_id', accountId)
                .eq('es_fuente_stock', true)
                .in('external_item_id', [...new Set(itemsPayload.filter((r: any) => r.id_publicacion_padre).map((r: any) => r.id_publicacion_padre))]);

            const padresConFuente = new Set((padresFuente || []).map((p: any) => p.external_item_id));

            // Derivadas cuyo padre NO es fuente de stock → promover
            const huerfanas = derivadasEnBatch.filter((itemId: string) => {
                const row = itemsPayload.find((r: any) => r.external_item_id === itemId && r.external_variation_id === '0');
                return row && !padresConFuente.has(row.id_publicacion_padre);
            });

            if (huerfanas.length > 0) {
                const { error: promoError } = await supabase
                    .from('publicaciones_externas')
                    .update({ es_fuente_stock: true })
                    .eq('marketplace_id', accountId)
                    .in('external_item_id', huerfanas)
                    .eq('external_variation_id', '0');

                if (promoError) {
                    logger.warn({ accountId, error: promoError.message }, 'Error promoviendo derivadas huérfanas a fuente de stock');
                } else {
                    logger.info({ accountId, count: huerfanas.length }, 'Derivadas huérfanas promovidas a fuente de stock');
                }
            }
        }
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


    // -------------------------------------------------------------------------
    // reconcileClosedItems — Detecta publicaciones en BD con status aparentemente
    // activo que MeLi ya cerró/desactivó. El sync normal no las detecta porque
    // getAccountItems solo devuelve items que MeLi indexa activamente.
    // Usa multiGET directo /items?ids=... que sí retorna items cerrados.
    //
    // Cuándo se llama:
    // - Como post-step del sync completo de catálogo
    // - Como job programado 1 vez/día (futuro)
    //
    // Costo: 1 request por cada 20 items con status activo en BD. Negligible.
    // -------------------------------------------------------------------------
    async reconcileClosedItems(accountId: string): Promise<{
        checked: number;
        updated: number;
        details: Array<{ item_id: string; old_status: string; new_status: string }>;
    }> {
        // 1. IDs de items que en BD aparecen activos (solo filas padre)
        const { data: bdActivos } = await supabase
            .from('publicaciones_externas')
            .select('external_item_id, status_externo')
            .eq('marketplace_id', accountId)
            .eq('external_variation_id', '0')
            .in('status_externo', ['active', 'paused', 'under_review']);

        if (!bdActivos || bdActivos.length === 0) {
            logger.info({ accountId }, 'reconcileClosedItems: sin items activos en BD, nada que verificar');
            return { checked: 0, updated: 0, details: [] };
        }

        const itemIds = bdActivos.map((r: any) => r.external_item_id);
        const bdStatusMap = new Map(bdActivos.map((r: any) => [r.external_item_id, r.status_externo]));
        const details: Array<{ item_id: string; old_status: string; new_status: string }> = [];
        let updated = 0;

        // Obtener token via el accessor existente del adapter
        const accessToken = await this.getAccessToken(accountId);
        const CHUNK = 20;

        for (let i = 0; i < itemIds.length; i += CHUNK) {
            const chunk = itemIds.slice(i, i + CHUNK);
            try {
                // MultiGET — MeLi retorna status real incluso de items cerrados
                const resp = await axios.get(
                    `https://api.mercadolibre.com/items?ids=${chunk.join(',')}&attributes=id,status,sub_status`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );

                for (const res of resp.data) {
                    if (res.code !== 200 || !res.body) continue;

                    const meliStatus: string = res.body.status;
                    const itemId: string = res.body.id;
                    const oldStatus = bdStatusMap.get(itemId) || 'unknown';

                    // Solo actualizar si MeLi reporta un estado terminal que difiere del de BD
                    if (['closed', 'inactive'].includes(meliStatus) && oldStatus !== meliStatus) {
                        const { error } = await supabase
                            .from('publicaciones_externas')
                            .update({
                                status_externo: meliStatus,
                                sub_status: res.body.sub_status || [],
                                actualizado_el: new Date().toISOString(),
                            })
                            .eq('marketplace_id', accountId)
                            .eq('external_item_id', itemId);

                        if (!error) {
                            details.push({ item_id: itemId, old_status: oldStatus, new_status: meliStatus });
                            updated++;
                        } else {
                            logger.warn({ accountId, itemId, error: error.message }, 'reconcileClosedItems: error al actualizar status');
                        }
                    }
                }
            } catch (err: any) {
                logger.warn({ accountId, chunk, error: err.message }, 'reconcileClosedItems: error en chunk multiGET');
            }
        }

        logger.info({ accountId, checked: itemIds.length, updated }, 'reconcileClosedItems completado');
        return { checked: itemIds.length, updated, details };
    }


    // -------------------------------------------------------------------------
    // V27 — enrichCatalogBatch: comisiones + visitas + descripciones (separado del sync)
    // Se llama desde /api/sync/enrich — NO desde syncCatalogBatchFast
    // -------------------------------------------------------------------------
    async enrichCatalogBatch(accountId: string, accessToken: string, itemIds: string[]): Promise<void> {
        const CONCURRENCY = 10;

        // -- Comisiones (paralelas, cacheadas por combinación) ----------------
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

        // -- Visitas 30d (/items/{id}/visits/time_window?last=30&unit=day) ---
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

        // -- Costo de envio (free shipping) ---
        try {
            const { data: mkp } = await supabase.from('marketplace_configs').select('settings').eq('id', accountId).single();
            const sellerId = mkp?.settings?.seller_id;
            
            if (sellerId) {
                const { data: pubRows } = await supabase
                    .from('publicaciones_externas')
                    .select('external_item_id, free_shipping')
                    .eq('marketplace_id', accountId)
                    .in('external_item_id', itemIds);

                const freeShippingMap = new Map<string, boolean>();
                (pubRows || []).forEach(p => {
                    freeShippingMap.set(p.external_item_id, p.free_shipping === true);
                });

                for (let i = 0; i < itemIds.length; i += CONCURRENCY) {
                    const chunk = itemIds.slice(i, i + CONCURRENCY);
                    await Promise.all(chunk.map(async (itemId: string) => {
                        try {
                            const isFree = freeShippingMap.get(itemId) ?? false;
                            const queryParam = isFree ? '&free_shipping=true' : '';
                            const path = `/users/${sellerId}/shipping_options/free?item_id=${itemId}${queryParam}`;
                            const shipResp = await axios.get(
                                `https://autofichaje2026-dashboard-1img.vercel.app/api/admin/debug-meli?account_id=${accountId}&path=${encodeURIComponent(path)}`
                            );
                            const listCost = shipResp.data?.coverage?.all_country?.list_cost;
                            if (listCost != null) {
                                await supabase
                                    .from('publicaciones_externas')
                                    .update({ shipping_cost_monto: listCost })
                                    .eq('marketplace_id', accountId)
                                    .eq('external_item_id', itemId);
                            } else if (shipResp.data?.status === 403) {
                                logger.error({ accountId, itemId, error: shipResp.data }, 'V31: ML bloqueó la petición de envíos (403 PolicyAgent)');
                            } else if (shipResp.data?.error) {
                                logger.error({ accountId, itemId, error: shipResp.data.error }, 'V31: Error reportado por el proxy');
                            }
                        } catch (err: any) {
                            logger.error({ accountId, itemId, error: err.message }, 'V31: Fallo al obtener shipping_options/free');
                        }
                    }));
                }
                logger.debug({ accountId, items: itemIds.length }, 'V31: costos de envio enriquecidos');
            }
        } catch (shipErr: any) {
            logger.warn({ accountId, error: shipErr.message }, 'V31: error en enriquecimiento de envios');
        }

        // -- Descripciones (solo items sin descripción previa, máx 20) --------
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

        // Punto 7: fix par_item_id — rellenar catálogos cuyo par_item_id es NULL
        // pero comparten id_producto_catalogo con una tradicional (67 casos históricos + nuevos)
        try {
            await supabase.rpc('fix_par_item_id_faltantes', { p_marketplace_id: accountId });
        } catch (parErr: any) {
            logger.warn({ accountId, error: parErr.message }, 'V27: fix par_item_id falló (no crítico)');
        }
    }

    async getRecentOrders(accountId: string, since: Date): Promise<any[]> {
        const accessToken = await this.getAccessToken(accountId);

        // 1. Obtener seller_id (igual que en getAccountItems)
        await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 5);
        const meResp = await axios.get('https://api.mercadolibre.com/users/me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const sellerId = meResp.data.id;

        const orders: any[] = [];
        let offset = 0;
        const limit = 50;

        // 2. Paginar /orders/search
        while (true) {
            await checkRateLimit(accountId, this.capabilities.maxStockUpdateRate, 5);
            const resp = await axios.get('https://api.mercadolibre.com/orders/search', {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: {
                    seller: sellerId,
                    'order.status': 'paid',
                    'order.date_created.from': since.toISOString(),
                    sort: 'date_desc',
                    offset,
                    limit
                }
            });

            const results: any[] = resp.data.results || [];
            const total: number = resp.data.paging?.total || 0;

            orders.push(...results);
            offset += results.length;

            // MeLi limita a ~1000 órdenes por búsqueda; el parámetro 'since' acota el resultado
            if (results.length < limit || offset >= total) break;
        }

        logger.info({ accountId, count: orders.length, since: since.toISOString() }, 'getRecentOrders completado');
        return orders;
    }

    // -------------------------------------------------------------------------
    // PUBLICADOR — Métodos para crear publicaciones nuevas en MeLi
    // Agregados en v_publish_01
    // -------------------------------------------------------------------------

    /**
     * detectSellerModel — Verifica si la cuenta opera en modelo User Products (UP) o legacy.
     * Llama GET /users/me y busca el tag "user_product_seller".
     * Retorna: { model: 'up' | 'legacy', seller_id: number, tags: string[] }
     * El resultado debe guardarse en marketplace_configs para no repetir la consulta.
     */
    async detectSellerModel(accountId: string): Promise<{
        model: 'up' | 'legacy';
        seller_id: number;
        tags: string[];
        nickname: string;
    }> {
        const accessToken = await this.getAccessToken(accountId);
        const resp = await axios.get('https://api.mercadolibre.com/users/me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const tags: string[] = resp.data.tags || [];
        const isUP = tags.includes('user_product_seller');
        logger.info(
            { accountId, seller_id: resp.data.id, model: isUP ? 'up' : 'legacy', tags },
            'detectSellerModel completado'
        );
        return {
            model: isUP ? 'up' : 'legacy',
            seller_id: resp.data.id,
            tags,
            nickname: resp.data.nickname || '',
        };
    }

    /**
     * predictCategory — Sugiere una categoría de MeLi para un texto de búsqueda.
     * Llama GET /sites/MLM/domain-discovery/search?q={query}
     * Retorna el primer resultado: { category_id, domain_id, category_name }
     * El resultado se debe cachear en BD por categoría local para no repetir.
     */
    async predictCategory(accountId: string, query: string): Promise<{
        category_id: string;
        domain_id: string;
        category_name: string;
        candidates: { category_id: string; category_name: string; domain_id: string }[];
        raw: any[];
    }> {
        const accessToken = await this.getAccessToken(accountId);
        const encoded = encodeURIComponent(query.trim().slice(0, 100));
        const resp = await axios.get(
            `https://api.mercadolibre.com/sites/MLM/domain_discovery/search?q=${encoded}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const results: any[] = resp.data || [];
        if (results.length === 0) {
            throw new Error(`predictCategory: MeLi no devolvió categorías para la query "${query}"`);
        }
        const top = results[0];
        logger.info(
            { accountId, query, category_id: top.category_id, domain_id: top.domain_id },
            'predictCategory: categoría sugerida por MeLi'
        );
        return {
            category_id: top.category_id,
            domain_id: top.domain_id,
            category_name: top.category_name || top.domain_name || '',
            candidates: results.slice(0, 10).map((r: any) => ({
                category_id: r.category_id,
                category_name: r.category_name || r.domain_name || '',
                domain_id: r.domain_id,
            })),
            raw: results,
        };
    }

    /**
     * getCategoryAttributes — Obtiene los atributos requeridos y opcionales de una categoría.
     * Llama GET /categories/{category_id}/attributes
     * Retorna listas separadas: required[], parent_pk[], child_pk[], optional[]
     * Cada atributo incluye id, name, type y valores permitidos si los tiene.
     */
    async getCategoryAttributes(accountId: string, categoryId: string): Promise<{
        required: any[];
        parent_pk: any[];
        child_pk: any[];
        optional: any[];
        raw: any[];
    }> {
        const accessToken = await this.getAccessToken(accountId);
        const resp = await axios.get(
            `https://api.mercadolibre.com/categories/${categoryId}/attributes`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const raw: any[] = resp.data || [];

        const required   = raw.filter((a: any) => (a.tags || {}).required === true);
        const parent_pk  = raw.filter((a: any) => (a.tags || {}).defines_picture === true
            || (a.tags || {}).is_identifier === true
            || a.id === 'BRAND' || a.id === 'MODEL');
        const child_pk   = raw.filter((a: any) =>
            (a.tags || {}).allow_variations === true &&
            !(a.tags || {}).defines_picture
        );
        const optional   = raw.filter((a: any) => !(a.tags || {}).required);

        logger.info(
            { accountId, categoryId, total: raw.length, required: required.length, parent_pk: parent_pk.length, child_pk: child_pk.length },
            'getCategoryAttributes completado'
        );
        return { required, parent_pk, child_pk, optional, raw };
    }

    /**
     * createItem — Crea una publicación nueva en MeLi.
     * Soporta modelo User Products (UP): family_name, sin title, sin variations[].
     * Soporta modelo legacy: title, con variations[] si aplica.
     * El caller debe construir el body correcto y pasarlo completo.
     * Retorna la respuesta completa de MeLi: item_id, user_product_id, permalink, title generado, etc.
     */
    async createItem(accountId: string, itemBody: {
        // Modelo UP (obligatorio si model='up')
        family_name?: string;
        // Modelo legacy (obligatorio si model='legacy')
        title?: string;
        // Campos comunes obligatorios
        category_id: string;
        price: number;
        currency_id: string;
        available_quantity: number;
        buying_mode: string;
        listing_type_id: string;
        sale_terms: Array<{ id: string; value_name: string }>;
        pictures: Array<{ source: string }>;
        attributes: Array<{ id: string; value_name?: string; value_id?: string; value_struct?: { number: number; unit: string } }>;
        // Opcionales
        condition?: string;
        shipping?: any;
        channels?: string[];
    }): Promise<{
        item_id: string;
        user_product_id: string | null;
        family_id: string | null;
        permalink: string;
        title: string;
        status: string;
        raw: any;
    }> {
        const accessToken = await this.getAccessToken(accountId);

        // Nunca enviar title en modelo UP — MeLi lo genera
        // Nunca enviar variations[] — en UP cada variante es un POST separado
        const body = { ...itemBody };

        logger.info(
            { accountId, family_name: body.family_name, title: body.title, category_id: body.category_id, price: body.price },
            'createItem: iniciando POST /items'
        );

        let respData: any;
        try {
            const resp = await axios.post(
                'https://api.mercadolibre.com/items',
                body,
                { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
            );
            respData = resp.data;
        } catch (err: any) {
            const meliError = err.response?.data;
            logger.error({ accountId, meliError, statusCode: err.response?.status }, 'createItem: MeLi rechazó el POST /items');
            // Re-lanzar con el cuerpo de error de MeLi visible
            throw new Error(
                `MeLi POST /items falló [${err.response?.status}]: ${JSON.stringify(meliError)}`
            );
        }

        logger.info(
            {
                accountId,
                item_id: respData.id,
                user_product_id: respData.user_product_id,
                title: respData.title,
                status: respData.status,
            },
            'createItem: publicación creada exitosamente en MeLi'
        );

        return {
            item_id: respData.id,
            user_product_id: respData.user_product_id || null,
            family_id: respData.family_id || null,
            permalink: respData.permalink || '',
            title: respData.title || '',
            status: respData.status || '',
            raw: respData,
        };
    }

    /**
     * addDescription — Agrega descripción en texto plano a un item ya creado.
     * Llama POST /items/{item_id}/description
     * Debe llamarse DESPUÉS de createItem. No es posible incluirla en el POST inicial.
     */
    async addDescription(accountId: string, itemId: string, plainText: string): Promise<{
        item_id: string;
        ok: boolean;
        raw: any;
    }> {
        const accessToken = await this.getAccessToken(accountId);
        const text = plainText.trim().slice(0, 50000); // límite de MeLi

        logger.info({ accountId, itemId, length: text.length }, 'addDescription: iniciando POST /items/{id}/description');

        let respData: any;
        try {
            const resp = await axios.post(
                `https://api.mercadolibre.com/items/${itemId}/description`,
                { plain_text: text },
                { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
            );
            respData = resp.data;
        } catch (err: any) {
            const meliError = err.response?.data;
            logger.error({ accountId, itemId, meliError }, 'addDescription: MeLi rechazó el POST description');
            throw new Error(
                `MeLi POST /items/${itemId}/description falló [${err.response?.status}]: ${JSON.stringify(meliError)}`
            );
        }

        logger.info({ accountId, itemId }, 'addDescription: descripción agregada exitosamente');
        return { item_id: itemId, ok: true, raw: respData };
    }

    /**
     * searchCatalog — Busca productos en el catálogo de MeLi (catalog_product_id)
     * por GTIN/EAN o texto libre. Devuelve los resultados del product search.
     */
    async searchCatalog(accountId: string, query: string): Promise<{ results: any[] }> {
        const accessToken = await this.getAccessToken(accountId);
        try {
            const resp = await axios.get('https://api.mercadolibre.com/products/search', {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { status: 'active', site_id: 'MLM', q: query, limit: 5 },
            });
            const results = Array.isArray(resp.data?.results) ? resp.data.results : [];
            logger.info({ accountId, query, count: results.length }, 'searchCatalog completado');
            return { results };
        } catch (err: any) {
            logger.error({ accountId, query, error: err.response?.data || err.message }, 'searchCatalog falló');
            return { results: [] };
        }
    }

    /**
     * updateListingType — Cambia el tipo de publicación de un item existente
     * (gold_special <-> gold_pro) sin crear duplicados. POST /items/{id}/listing_type.
     */
    async updateListingType(accountId: string, itemId: string, listingTypeId: string): Promise<any> {
        const accessToken = await this.getAccessToken(accountId);
        const resp = await axios.post(
            `https://api.mercadolibre.com/items/${itemId}/listing_type`,
            { id: listingTypeId },
            { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
        );
        logger.info({ accountId, itemId, listingTypeId }, 'updateListingType completado');
        return resp.data;
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

