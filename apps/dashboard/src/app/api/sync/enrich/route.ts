import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { getValidAccessToken } from '@gestor/shared/lib/meli-token';

const MAX_EXECUTION_MS = 8000;
const BATCH_SIZE        = 50; // items por llamada a enrichCatalogBatch

export async function POST(request: Request) {
    const START_TIME = Date.now();

    try {
        const body       = await request.json();
        const accountId  = body.accountId;
        const offset     = body.offset ?? 0;        // relay position
        const pageSize   = body.pageSize ?? BATCH_SIZE;

        if (!accountId) {
            return NextResponse.json({ error: 'accountId es requerido' }, { status: 400 });
        }

        // Obtener lista completa de external_item_id para la cuenta (solo filas padre)
        // Usamos la paginación de Supabase para el relay
        const { data: itemRows, count } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('external_item_id', { count: 'exact' })
            .eq('marketplace_id', accountId)
            .eq('external_variation_id', '0')   // solo filas padre
            .range(offset, offset + pageSize - 1);

        const total = count ?? 0;

        if (!itemRows || itemRows.length === 0) {
            return NextResponse.json({
                message: 'Enriquecimiento completado — no hay items en este rango',
                hasMore: false,
                offset,
                processed: 0,
                total,
            });
        }

        const itemIds  = itemRows.map((r: any) => r.external_item_id).filter(Boolean);
        const meli     = new MeliAdapter();
        const accessToken = await getValidAccessToken(accountId, supabaseAdmin);

        await meli.enrichCatalogBatch(accountId, accessToken, itemIds);

        const newOffset  = offset + itemRows.length;
        const hasMore    = newOffset < total;
        const elapsed    = Date.now() - START_TIME;

        return NextResponse.json({
            message: hasMore ? 'Enriquecimiento en progreso' : 'Enriquecimiento completado',
            hasMore,
            offset: newOffset,
            processed: itemRows.length,
            total,
            elapsed,
        });

    } catch (error: any) {
        console.error('API Enrich Error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
