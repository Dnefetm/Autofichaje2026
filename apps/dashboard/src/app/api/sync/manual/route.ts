import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { checkRateLimit } from '@gestor/shared/lib/rate-limiter';
import { MeliAdapter } from '@gestor/adapters/meli';
import logger from '@gestor/shared/lib/logger';
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

        // 1. Obtener User ID con acceso local al token (Simulando getAccountItems paginado manual)
        // En lugar de llamar getAccountItems() que no podemos interrumpir por dentro de a gratis,
        // haremos la lógica de iteración aquí en el propio route.ts para controlarla con reloj:

        const { data: tokenData, error: tokenError } = await supabaseAdmin
            .from('marketplace_tokens')
            .select('access_token')
            .eq('marketplace_id', accountId)
            .single();

        if (tokenError || !tokenData) throw new Error('Cuenta no vinculada o sin tokens en BD');
        // Usar accesor del adaptador es óptimo, pero por tiempo extraemos manual. Ojo: decrypt está empaquetado.
        // Dado que el adaptador de MeLi ya tiene métodos, mejor aprovechemos la clase.

        // Truco: Para no duplicar código decrypt, hacemos bypass si la clase lo permite, o 
        // más fácil recabamos la lista de IDs primero.

        const { decrypt } = await import('@gestor/shared/lib/crypto');
        const accessToken = decrypt(tokenData.access_token);

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
