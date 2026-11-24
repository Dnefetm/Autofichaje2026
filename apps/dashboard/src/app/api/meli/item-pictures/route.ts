import { NextRequest, NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

import { toHighResMeliUrl } from '@/lib/image-utils';
import { extractFiscalFromMeliAttributes } from '@/lib/meli-fiscal';

export const dynamic = 'force-dynamic';

/**
 * GET /api/meli/item-pictures?accountId=...&itemId=...
 *
 * Devuelve la lista completa de URLs de imágenes y atributos fiscales de un ítem de MeLi.
 * Se usa bajo demanda para pre-cargar fotos y datos fiscales de la vidriera origen en el copiador.
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
            .map((p: any) => toHighResMeliUrl(p.secure_url || p.url))
            .filter(Boolean);
        const fiscal = extractFiscalFromMeliAttributes(item?.attributes);
        return NextResponse.json({ ok: true, pictures, fiscal });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
    }
}
