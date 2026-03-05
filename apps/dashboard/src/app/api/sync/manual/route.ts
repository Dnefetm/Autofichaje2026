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
        let scrollId = body.scrollId || null; // Para relay entre invocaciones Serverless

        while (hasMore) {
            // Reloj Verificador
            if (Date.now() - START_TIME > MAX_EXECUTION_MS) {
                logger.info({ accountId, scrollId }, 'Time-Aware BATCHING PAUSE: Cortando antes del Timeout de Vercel');
                return NextResponse.json({
                    message: 'Sincronización en pausa estratégica',
                    hasMore: true,
                    scrollId,
                    nextOffset: currentOffset, // Mantener compatibilidad con frontend
                    processedSoFar: itemIdsProcessed
                });
            }

            await checkRateLimit(accountId, 10, 1);

            const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search`;
            const params: any = { limit };

            if (scrollId) {
                // Usar scroll_id para continuar paginación sin límite de offset
                params.scroll_id = scrollId;
            } else if (currentOffset > 0 && currentOffset < 1000) {
                // Primera invocación con offset < 1000: seguir con offset normal
                params.offset = currentOffset;
            }
            // Si es la primera invocación (offset=0, sin scrollId), no pasar ninguno de los dos

            const response = await axios.get(searchUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params
            });

            const results = response.data.results || [];
            // Capturar scroll_id para la siguiente iteración
            scrollId = response.data.scroll_id || scrollId;

            if (results.length > 0) {
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
