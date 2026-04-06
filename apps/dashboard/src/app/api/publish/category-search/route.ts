import { NextRequest, NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

/**
 * GET /api/publish/category-search?q=dado+metrico+10mm&marketplace_id=<uuid>
 *
 * Búsqueda live de categorías MeLi usando domain_discovery/search.
 * Devuelve hasta 10 candidatos con category_id y category_name.
 * Usado por el buscador de categorías en el publish-panel.
 */
export async function GET(req: NextRequest) {
    const q           = req.nextUrl.searchParams.get('q')?.trim();
    const marketplaceId = req.nextUrl.searchParams.get('marketplace_id');

    if (!q || q.length < 2) {
        return NextResponse.json({ ok: true, candidates: [] });
    }
    if (!marketplaceId) {
        return NextResponse.json({ ok: false, error: 'marketplace_id requerido' }, { status: 400 });
    }

    try {
        const meli   = new MeliAdapter();
        const result = await (meli as any).predictCategory(marketplaceId, q.slice(0, 100));
        return NextResponse.json({
            ok:         true,
            query:      q,
            candidates: result.candidates || [],
        });
    } catch (err: any) {
        console.error('[/api/publish/category-search] Error:', err?.message);
        return NextResponse.json(
            { ok: false, error: err?.message || 'Error al buscar en MeLi' },
            { status: 500 }
        );
    }
}
