import { NextRequest, NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

/**
 * GET /api/publish/category-search?q=dado+metrico+10mm&marketplace_id=<uuid>
 *
 * Búsqueda live de categorías MeLi usando domain_discovery/search.
 * Devuelve hasta 10 candidatos deduplicados, con category_id, category_name y path completo.
 * El path se obtiene de /categories/{id} (endpoint público, sin token).
 */
export async function GET(req: NextRequest) {
    const q            = req.nextUrl.searchParams.get('q')?.trim();
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

        // Deduplicar por category_id (domain_discovery puede devolver el mismo ID con distintos domains)
        const seen   = new Set<string>();
        const unique = (result.candidates || []).filter((c: any) => {
            if (seen.has(c.category_id)) return false;
            seen.add(c.category_id);
            return true;
        });

        // Enriquecer con path_from_root — endpoint público de MeLi, no requiere token
        const enriched = await Promise.all(
            unique.map(async (c: any) => {
                try {
                    const r = await fetch(
                        `https://api.mercadolibre.com/categories/${encodeURIComponent(c.category_id)}`,
                        { next: { revalidate: 300 } }   // cache 5 min en Next.js
                    );
                    if (!r.ok) return c;
                    const data = await r.json();
                    const path: string = (data.path_from_root || [])
                        .map((p: any) => p.name)
                        .join(' / ');
                    return { ...c, path: path || c.category_name };
                } catch {
                    return c;
                }
            })
        );

        return NextResponse.json({
            ok:         true,
            query:      q,
            candidates: enriched,
        });
    } catch (err: any) {
        console.error('[/api/publish/category-search] Error:', err?.message);
        return NextResponse.json(
            { ok: false, error: err?.message || 'Error al buscar en MeLi' },
            { status: 500 }
        );
    }
}
