import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/meli/item-details?itemId=MLM...&accountId=uuid
 *
 * Hace 3 llamadas paralelas a la API de MeLi y retorna:
 *  - health: acciones de salud sugeridas
 *  - costs: comisión real (MXN) y costo de envío estimado
 *  - visits: visitas de los últimos 30 días
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const itemId    = searchParams.get('itemId');
    const accountId = searchParams.get('accountId');

    if (!itemId || !accountId) {
        return NextResponse.json({ error: 'itemId y accountId son requeridos' }, { status: 400 });
    }

    // Obtener access_token de la cuenta
    const { data: mcData, error: mcErr } = await supabase
        .from('marketplace_configs')
        .select('access_token, user_id')
        .eq('id', accountId)
        .single();

    if (mcErr || !mcData?.access_token) {
        return NextResponse.json({ error: 'Cuenta no encontrada o sin access_token' }, { status: 404 });
    }

    const token = mcData.access_token;
    const headers = { Authorization: `Bearer ${token}` };

    // Fechas para visitas (últimos 30 días)
    const now       = new Date();
    const dateFrom  = new Date(now);
    dateFrom.setDate(dateFrom.getDate() - 30);
    const dateTo    = now.toISOString().split('T')[0];
    const dateFromS = dateFrom.toISOString().split('T')[0];

    // Llamadas en paralelo: health + costs + visits
    const [healthResult, costsResult, visitsResult] = await Promise.allSettled([
        axios.get(`https://api.mercadolibre.com/items/${itemId}/health`, { headers }),
        axios.get(`https://api.mercadolibre.com/items/${itemId}/costs?quantity=1`, { headers }),
        axios.get(
            `https://api.mercadolibre.com/visits/items/${itemId}?date_from=${dateFromS}&date_to=${dateTo}`,
            { headers }
        ),
    ]);

    const health = healthResult.status === 'fulfilled'
        ? healthResult.value.data
        : null;

    const costs = costsResult.status === 'fulfilled'
        ? costsResult.value.data
        : null;

    const visits = visitsResult.status === 'fulfilled'
        ? visitsResult.value.data
        : null;

    return NextResponse.json({ health, costs, visits });
}
