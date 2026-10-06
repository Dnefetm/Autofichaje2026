import { NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/logistica-full/sync-uno — sincroniza stock + replenishment de UN solo
// inventory_id en UNA cuenta (puntual, no masivo; no consume el rate-limit global).
// body: { accountId, inventoryId }
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const accountId = body.accountId as string | undefined;
        const inventoryId = body.inventoryId as string | undefined;
        if (!accountId || !inventoryId) {
            return NextResponse.json({ error: 'accountId e inventoryId requeridos' }, { status: 400 });
        }
        const meli = new MeliAdapter();
        const result = await meli.syncInventoryPuntual(accountId, inventoryId);
        return NextResponse.json({ success: true, result });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error en sync puntual' }, { status: 500 });
    }
}
