import { NextRequest, NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

/**
 * GET /api/meli/item-details?itemId=MLM...&accountId=uuid
 *
 * Hace 3 llamadas paralelas a la API de MeLi (vía MeliAdapter con token descifrado de
 * marketplace_tokens y auto-refresh) y retorna:
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

    try {
        const meli = new MeliAdapter();
        const details = await meli.getItemDetails(accountId, itemId);
        return NextResponse.json(details);
    } catch (err: any) {
        const msg = err?.message || 'Error consultando detalles en MeLi';
        const status = msg.includes('access_token') || msg.includes('Token expirado') ? 404 : 502;
        return NextResponse.json({ error: msg }, { status });
    }
}
