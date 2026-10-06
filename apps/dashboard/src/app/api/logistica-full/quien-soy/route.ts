import { NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// POST /api/logistica-full/quien-soy — devuelve el vendedor real del token de una cuenta.
// body: { accountId }
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const accountId = body.accountId as string | undefined;
        if (!accountId) return NextResponse.json({ error: 'accountId requerido' }, { status: 400 });
        const meli = new MeliAdapter();
        const me = await meli.whoAmI(accountId);
        return NextResponse.json({
            success: true,
            accountId,
            seller: {
                id: me?.id ?? null,
                nickname: me?.nickname ?? null,
                site_id: me?.site_id ?? null,
                country_id: me?.country_id ?? null,
            },
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error consultando /users/me' }, { status: 500 });
    }
}
