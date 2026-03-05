import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import logger from '@gestor/shared/lib/logger';
import { getValidAccessToken } from '@gestor/shared/lib/meli-token';
import axios from 'axios';

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
        const accessToken = await getValidAccessToken(accountId, supabaseAdmin);

        // Cachear userId entre relays
        let userId = body.userId || null;
        if (!userId) {
            const meResponse = await axios.get('https://api.mercadolibre.com/users/me', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            userId = meResponse.data.id;
        }

        const limit = 100;
        let itemIdsProcessed = 0;
        let hasMore = true;
        let scrollId = body.scrollId || null;
        let iterationCount = 0;
        const diagnosticLogs: string[] = [];

        while (hasMore) {
            if (Date.now() - START_TIME > MAX_EXECUTION_MS) {
                return NextResponse.json({
                    message: 'Sincronización en pausa estratégica',
                    hasMore: true,
                    scrollId,
                    userId,
                    processedSoFar: itemIdsProcessed,
                    diagnosticLogs
                });
            }

            iterationCount++;
            const searchUrl = `https://api.mercadolibre.com/users/${userId}/items/search`;

            // search_type=scan SIEMPRE — MeLi lo requiere en TODAS las peticiones
            // Sin él, MeLi ignora el scroll_id y reinicia desde offset 0
            const params: any = { limit, search_type: 'scan' };

            if (scrollId) {
                params.scroll_id = scrollId;
            }

            const response = await axios.get(searchUrl, {
                headers: { Authorization: `Bearer ${accessToken}` },
                params
            });

            const results = response.data.results || [];

            // DIAGNÓSTICO: loguear toda la info relevante de cada iteración
            const newScrollId = response.data.scroll_id || null;
            const pagingInfo = response.data.paging || {};
            const firstIds = results.slice(0, 3);
            const diagLine = `iter=${iterationCount} | results=${results.length} | scroll_id_received=${newScrollId ? newScrollId.substring(0, 20) + '...' : 'null'} | scroll_id_same=${newScrollId === scrollId} | paging=${JSON.stringify(pagingInfo)} | first3=${JSON.stringify(firstIds)}`;
            diagnosticLogs.push(diagLine);
            console.log('[MELI SCAN DIAG]', diagLine);

            // Actualizar scroll_id con lo que MeLi devuelva
            if (newScrollId) {
                scrollId = newScrollId;
            }

            if (results.length === 0) {
                hasMore = false;
            } else {
                const synced = await meli.syncCatalogBatchFast(accountId, accessToken, results);
                itemIdsProcessed += synced;
            }
        }

        return NextResponse.json({
            message: 'Sincronización finalizada con éxito',
            hasMore: false,
            userId,
            totalProcessed: itemIdsProcessed,
            totalIterations: iterationCount,
            diagnosticLogs
        });

    } catch (error: any) {
        console.error('API Manual Sync Error:', error.response?.data || error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
