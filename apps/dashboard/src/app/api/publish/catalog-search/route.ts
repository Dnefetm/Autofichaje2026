import { NextRequest, NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const gtin = String(body?.gtin || '').trim();
    const marketplace_id = body?.marketplace_id;
    if (!gtin || !marketplace_id) {
        return NextResponse.json({ ok: false, error: 'Se requieren gtin y marketplace_id' }, { status: 400 });
    }

    const meli = new MeliAdapter();
    const { results } = await (meli as any).searchCatalog(marketplace_id, gtin);

    if (!results || results.length === 0) {
        return NextResponse.json({ ok: true, encontrado: false, resultados: [] });
    }

    const resultados = results.map((r: any) => ({
        catalog_product_id: r.id,
        titulo: r.title || r.name || '',
        thumbnail: r.thumbnail || r.pictures?.[0]?.url || r.pictures?.[0]?.secure_url || '',
        precio_referencia: r.price ?? null,
        domain_id: r.domain_id || '',
        // Fotos completas del catálogo y TODOS los atributos (sin recortar)
        pictures: (r.pictures || []).map((p: any) => p.url || p.secure_url || '').filter(Boolean),
        atributos: (r.attributes || []).map((a: any) => ({ id: a.id, name: a.name, value_name: a.value_name })),
    }));

    return NextResponse.json({ ok: true, encontrado: true, resultados });
}
