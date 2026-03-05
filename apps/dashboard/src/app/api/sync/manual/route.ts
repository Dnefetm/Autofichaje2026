import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRateLimit } from '@gestor/shared/lib/rate-limiter';
import { MeliAdapter } from '@gestor/adapters/meli';
import logger from '@gestor/shared/lib/logger';
import { getValidAccessToken } from '@gestor/shared/lib/meli-token';
import axios from 'axios';

export async function POST(request: Request) {
    const START_TIME = Date.now();
    const MAX_EXECUTION_MS = 8500; // Cortar a los 8.5seg por culpa de Vercel Hobby

    try {
        const body = await request.json();
        const accountId = body.accountId;
        let currentOffset = body.offset || 0;

        if (!accountId) {
            return NextResponse.json({ error: 'accountId es requerido' }, { status: 400 });
        }

        const meli = new MeliAdapter();

        // 1. Obtener token válido (refresca automáticamente si expiró)
        const accessToken = await getValidAccessToken(accountId, supabaseAdmin);

        // 2. Obtener userId de MeLi
        const meResponse = await axios.get('https://api.mercadolibre.com/users/me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const userId = meResponse.data.id;

        const limit = 50;
        let itemIdsProcessed = 0;
        let hasMore = true;

        while (hasMore) {
            // Reloj Verificador
            if (Date.now() - START_TIME > MAX_EXECUTION_MS) {
                logger.info({ accountId, currentOffset }, 'Time-Aware BATCHING PAUSE: Cortando antes del Timeout de Vercel');
                return NextResponse.json({
                    message: 'Sincronización en pausa estratégica',
                    hasMore: true,
                    nextOffset: currentOffset,
                    processedSoFar: itemIdsProcessed
                });
            }

            await checkRateLimit(accountId, 10, 1);

            const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search`;
            const response = await axios.get(searchUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { offset: currentOffset, limit }
            });

            const results = response.data.results || [];
            if (results.length > 0) {
                // Bajar masivamente hacia Supabase a través de nuestro nuevo Método Batch
                const synced = await meli.syncCatalogBatch(accountId, results);
                itemIdsProcessed += synced;
                currentOffset += limit;
            }

            if (results.length < limit || response.data.paging?.total <= currentOffset) {
                hasMore = false;
            }
        }

        return NextResponse.json({
            message: 'Sincronización finalizada con éxito',
            hasMore: false,
            totalProcessed: itemIdsProcessed
        });

    } catch (error: any) {
        console.error('API Manual Sync Error:', error.response?.data || error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
