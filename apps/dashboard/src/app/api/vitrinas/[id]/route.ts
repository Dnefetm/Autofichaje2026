import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { applyVitrinaChanges } from '@/lib/vitrina-sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vitrinas/[id]
 * Devuelve el contexto de edición en UNA sola carga: ítem real de MeLi +
 * descripción + metadatos de atributos de categoría. La ficha lo usa para
 * mostrar valores actuales de garantía (sale_terms), fotos (pictures) y
 * características secundarias (attributes) sin N llamadas.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    try {
        const { data: pub, error } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('marketplace_id, external_item_id, category_id')
            .eq('id', id)
            .single();
        if (error || !pub || !pub.external_item_id || !pub.marketplace_id) {
            return NextResponse.json({ ok: false, error: 'Publicación no encontrada' }, { status: 404 });
        }

        const meli = new MeliAdapter();
        const item = await (meli as any).getItem(pub.marketplace_id, pub.external_item_id);

        let description = '';
        try {
            description = await (meli as any).getDescription(pub.marketplace_id, pub.external_item_id);
        } catch { /* opcional */ }

        let categoryAttributes: any[] = [];
        if (pub.category_id) {
            try {
                const ca = await (meli as any).getCategoryAttributes(pub.marketplace_id, pub.category_id);
                categoryAttributes = ca?.raw || [];
            } catch { /* opcional */ }
        }

        return NextResponse.json({
            ok: true,
            item,
            description,
            categoryAttributes,
            isCatalog: item.catalog_listing === true || item.listing_type_id === 'gold_product_page',
            soldQuantity: Number(item.sold_quantity ?? 0),
            isUP: item.family_name != null,
        });
    } catch (err: any) {
        const msg = err?.response?.data?.message || err?.message || 'Error al obtener el contexto';
        console.error('[GET /api/vitrinas/[id]]', msg);
        return NextResponse.json({ ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) }, { status: 500 });
    }
}

/**
 * PATCH /api/vitrinas/[id]
 * Body: { changes: [{ field, value }, ...] }
 * Valida contra el esquema declarativo, sincroniza a MeLi (mecanismo real por
 * campo) y persiste localmente. Los fallos se reportan por campo.
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const changes = body?.changes;

    if (!Array.isArray(changes) || changes.length === 0) {
        return NextResponse.json({ ok: false, error: 'Se requiere changes: [{field, value}]' }, { status: 400 });
    }

    try {
        const result = await applyVitrinaChanges(id, changes);
        return NextResponse.json(result);
    } catch (err: any) {
        const msg =
            err?.response?.data?.message ||
            err?.response?.data?.error ||
            err?.message ||
            'Error al sincronizar';
        console.error('[PATCH /api/vitrinas/[id]]', msg);
        return NextResponse.json({ ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) }, { status: 500 });
    }
}
