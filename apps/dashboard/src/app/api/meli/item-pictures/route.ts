import { NextRequest, NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

/**
 * GET /api/meli/item-pictures?accountId=...&itemId=...
 *
 * Devuelve la lista completa de URLs de imágenes de un ítem de MeLi.
 * Se usa para pre-cargar las fotos de la vidriera origen en el copiador
 * de publicaciones entre cuentas.
 */
export async function GET(req: NextRequest) {
    const accountId = req.nextUrl.searchParams.get('accountId');
    const itemId = req.nextUrl.searchParams.get('itemId');

    if (!accountId || !itemId) {
        return NextResponse.json({ ok: false, error: 'accountId e itemId son obligatorios' }, { status: 400 });
    }

    const meli = new MeliAdapter();
    try {
        const item = await (meli as any).getItem(accountId, itemId);
        const pictures: string[] = (item?.pictures || [])
            .map((p: any) => p.secure_url || p.url)
            .filter(Boolean);
        return NextResponse.json({ ok: true, pictures });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
    }
}
