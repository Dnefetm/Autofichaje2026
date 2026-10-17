import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

/**
 * POST /api/catalog/external/[id]/apply-compatibilities
 * Re-resuelve y aplica las compatibilidades vehiculares (products_families con
 * value_id) a una publicación ya existente. Útil para corregir publicaciones que
 * quedaron con tag incomplete_compatibilities.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    if (!id) return NextResponse.json({ ok: false, error: 'id requerido' }, { status: 400 });

    try {
        const { data: pub } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('external_item_id, user_product_id, marketplace_id, domain_id')
            .eq('id', id)
            .single();
        if (!pub?.external_item_id) return NextResponse.json({ ok: false, error: 'Publicación no encontrada' }, { status: 404 });

        const { data: map } = await supabaseAdmin
            .from('mapeo_publicacion_articulo')
            .select('articulo_id')
            .eq('publicacion_id', id)
            .limit(1)
            .maybeSingle();
        if (!map?.articulo_id) return NextResponse.json({ ok: false, error: 'Sin artículo vinculado' }, { status: 404 });

        const { data: art } = await supabaseAdmin
            .from('articulos')
            .select('atributos_especificos')
            .eq('articulo_id', map.articulo_id)
            .single();
        const aplicaciones = art?.atributos_especificos?.compatibilidades;
        if (!Array.isArray(aplicaciones) || aplicaciones.length === 0) {
            return NextResponse.json({ ok: false, error: 'El artículo no tiene compatibilidades guardadas' }, { status: 400 });
        }

        const meli = new MeliAdapter();

        // User Products requieren su propio recurso de compatibilidades.
        let upId = pub.user_product_id ?? null;
        if (!upId) {
            try {
                const itemData = await meli.getItem(pub.marketplace_id, pub.external_item_id);
                upId = itemData?.user_product_id ?? null;
            } catch { upId = null; }
        }

        const comp = await meli.resolveCompatibilityFamilies(pub.marketplace_id, aplicaciones, pub.domain_id);
        if (!comp) return NextResponse.json({ ok: false, error: 'No se pudieron resolver compatibilidades (top_values)' }, { status: 400 });

        let res;
        try {
            res = await meli.addCompatibilities(pub.marketplace_id, pub.external_item_id, comp, upId);
        } catch (addErr: any) {
            return NextResponse.json({
                ok: false,
                error: 'MeLi rechazó las compatibilidades',
                meli_status: addErr?.response?.status ?? null,
                meli_body: addErr?.response?.data ?? null,
                payload: comp,
            }, { status: 502 });
        }
        return NextResponse.json({ ok: true, result: res, familias: comp.products_families?.length ?? 0, payload: comp });
    } catch (e: any) {
        return NextResponse.json({
            ok: false,
            error: e?.message || 'Error aplicando compatibilidades',
            meli_status: e?.response?.status ?? null,
            meli_body: e?.response?.data ?? null,
        }, { status: 500 });
    }
}
