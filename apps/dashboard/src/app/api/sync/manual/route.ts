import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import logger from '@gestor/shared/lib/logger';
import { getValidAccessToken } from '@gestor/shared/lib/meli-token';
import axios from 'axios';

// Rate limiter local en memoria — evita roundtrips HTTP a Redis/Upstash
// MeLi permite 10 req/seg; la latencia natural ya throttlea, esto es un safety net
const requestTimestamps: number[] = [];
function localRateLimit(maxPerSecond: number): Promise<void> {
    const now = Date.now();
    // Limpiar timestamps > 1 segundo
    while (requestTimestamps.length > 0 && requestTimestamps[0]! < now - 1000) {
        requestTimestamps.shift();
    }
    if (requestTimestamps.length >= maxPerSecond) {
        const waitMs = 1000 - (now - requestTimestamps[0]!);
        if (waitMs > 0) {
            return new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
    requestTimestamps.push(now);
    return Promise.resolve();
}

export async function POST(request: Request) {
    const START_TIME = Date.now();
    const MAX_EXECUTION_MS = 8500;

    try {
        const body = await request.json();
        const accountId = body.accountId;

        if (!accountId) {
            return NextResponse.json({ error: 'accountId es requerido' }, { status: 400 });
        }

        const meli = new MeliAdapter();

        // 1. Obtener token válido (refresca automáticamente si expiró)
        const accessToken = await getValidAccessToken(accountId, supabaseAdmin);

        // 2. Obtener userId — cacheado entre relays via body del frontend
        let userId = body.userId || null;
        if (!userId) {
            const meResponse = await axios.get('https://api.mercadolibre.com/users/me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            userId = meResponse.data.id;
        }

        // 3. Paginación con search_type=scan
        const limit = 100;
        let itemIdsProcessed = 0;
        let hasMore = true;
        let scrollId = body.scrollId || null;
        let isFirstRequest = !scrollId;

        while (hasMore) {
            if (Date.now() - START_TIME > MAX_EXECUTION_MS) {
                logger.info({ accountId, scrollId, itemIdsProcessed }, 'BATCHING PAUSE');
                return NextResponse.json({
                    message: 'Sincronización en pausa estratégica',
                    hasMore: true,
                    scrollId,
                    userId, // Cachear para el siguiente relay
                    processedSoFar: itemIdsProcessed
                });
            }

            await localRateLimit(10);

            const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search`;
            const params: any = { limit };

            if (isFirstRequest) {
                params.search_type = 'scan';
                isFirstRequest = false;
            } else if (scrollId) {
                params.scroll_id = scrollId;
            }

            const response = await axios.get(searchUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params
            });

            const results = response.data.results || [];
            scrollId = response.data.scroll_id || scrollId;

            if (results.length === 0) {
                hasMore = false;
            } else {
                // Pasar accessToken directamente — evita doble fetch de token en syncCatalogBatch
                const synced = await meli.syncCatalogBatchFast(accountId, accessToken, results);
                itemIdsProcessed += synced;
            }
        }

        return NextResponse.json({
            message: 'Sincronización finalizada con éxito',
            hasMore: false,
            userId,
            totalProcessed: itemIdsProcessed
        });

    } catch (error: any) {
        console.error('API Manual Sync Error:', error.response?.data || error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
