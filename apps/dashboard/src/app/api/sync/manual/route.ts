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

        // 3. Paginación con search_type=scan (único modo que soporta >1000 items)
        const limit = 100; // Máximo permitido por MeLi en modo scan
        let itemIdsProcessed = 0;
        let hasMore = true;
        let scrollId = body.scrollId || null;
        // Solo la primera petición de la cadena completa lleva search_type=scan
        let isFirstRequest = !scrollId;

        while (hasMore) {
            // Reloj — cortar antes del timeout de Vercel
            if (Date.now() - START_TIME > MAX_EXECUTION_MS) {
                logger.info({ accountId, scrollId, itemIdsProcessed }, 'BATCHING PAUSE: Cortando antes del Timeout de Vercel');
                return NextResponse.json({
                    message: 'Sincronización en pausa estratégica',
                    hasMore: true,
                    scrollId,
                    processedSoFar: itemIdsProcessed
                });
            }

            await checkRateLimit(accountId, 10, 1);

            const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search`;
            const params: any = { limit };

            if (isFirstRequest) {
                // Primera petición: activar modo scan
                params.search_type = 'scan';
                isFirstRequest = false;
            } else if (scrollId) {
                // Siguientes: solo scroll_id (sin offset, sin search_type)
                params.scroll_id = scrollId;
            }

            const response = await axios.get(searchUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params
            });

            const results = response.data.results || [];
            // Capturar scroll_id para la siguiente iteración
            scrollId = response.data.scroll_id || scrollId;

            // En modo scan, results vacío = fin de la lista (paging.total no aplica)
            if (results.length === 0) {
                hasMore = false;
            } else {
                const synced = await meli.syncCatalogBatch(accountId, results);
                itemIdsProcessed += synced;
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
