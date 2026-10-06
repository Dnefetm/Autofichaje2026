import { NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/logistica-full/list-items — devuelve el catálogo completo (IDs) del
// vendedor real del token de una cuenta. Fuente de verdad: ML API.
// body: { accountId }
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const accountId = body.accountId as string | undefined;
        if (!accountId) return NextResponse.json({ error: 'accountId requerido' }, { status: 400 });
        const meli = new MeliAdapter();
        const items = await meli.getAccountItems(accountId);
        return NextResponse.json({ success: true, count: items.length, items });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error listando items' }, { status: 500 });
    }
}
