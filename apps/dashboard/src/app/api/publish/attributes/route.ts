import { NextRequest, NextResponse } from 'next/server';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

/**
 * GET /api/publish/attributes?category_id=MLM438009&marketplace_id=<uuid>
 *
 * Devuelve los atributos requeridos y opcionales de una categoría MeLi.
 * Usado por el publish-panel cuando el usuario cambia la categoría en el preview
 * para mostrar los atributos correctos sin tener que repetir el dry_run completo.
 */
export async function GET(req: NextRequest) {
    const categoryId   = req.nextUrl.searchParams.get('category_id');
    const marketplaceId = req.nextUrl.searchParams.get('marketplace_id');

    if (!categoryId || !marketplaceId) {
        return NextResponse.json(
            { ok: false, error: 'category_id y marketplace_id son requeridos' },
            { status: 400 }
        );
    }

    try {
        const meli = new MeliAdapter();
        const attrInfo = await (meli as any).getCategoryAttributes(marketplaceId, categoryId);

        // Misma forma que trace.paso_6_atributos.required_detail en /api/publish
        const required = attrInfo.required.map((a: any) => ({
            id:     a.id,
            name:   a.name,
            type:   a.value_type,
            values: (a.values || []).slice(0, 50).map((v: any) => ({ id: String(v.id), name: v.name })),
        }));

        return NextResponse.json({
            ok:          true,
            category_id: categoryId,
            required,
            total:       attrInfo.raw?.length ?? 0,
        });
    } catch (err: any) {
        console.error('[/api/publish/attributes] Error:', err);
        return NextResponse.json(
            { ok: false, error: err?.message || 'Error al obtener atributos de MeLi' },
            { status: 500 }
        );
    }
}
