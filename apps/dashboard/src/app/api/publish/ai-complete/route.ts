import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { generateListingContent } from '@gestor/sync/listing-ai';
import { fillOptionalFromData, filterOptionalAttrs } from '@gestor/sync/attribute-fill';
import { MeliAdapter } from '@gestor/adapters/meli';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const articulo_id = body?.articulo_id || null;
    const category_id = body?.category_id || null;
    const marketplace_id = body?.marketplace_id || null;
    const source_marketplace_id = body?.source_marketplace_id || null;
    const source_item_id = body?.source_item_id || null;
    const manual_product = body?.manual_product || null;

    const hasSource = Boolean(source_marketplace_id && source_item_id);
    const hasManual = Boolean(manual_product && typeof manual_product.nombre === 'string' && manual_product.nombre.trim().length > 0);
    if (!articulo_id && !hasSource && !hasManual) {
        return NextResponse.json(
            { ok: false, error: 'Se requiere articulo_id, source_marketplace_id+source_item_id o manual_product.nombre' },
            { status: 400 },
        );
    }

    let articulo: any = null;
    let ficha: any = null;
    if (articulo_id) {
        const { data: artRow, error: artErr } = await supabaseAdmin
            .from('articulos')
            .select('*')
            .eq('articulo_id', articulo_id)
            .single();
        if (artErr || !artRow) {
            return NextResponse.json({ ok: false, error: 'Artículo no encontrado' }, { status: 404 });
        }
        articulo = artRow;

        const { data: fichas } = await supabaseAdmin
            .from('fichas_tecnicas')
            .select('*')
            .eq('articulo_id', articulo_id)
            .order('created_at', { ascending: false })
            .limit(1);
        ficha = fichas?.[0] || null;
    }

    const meli = new MeliAdapter();
    let sourceItem: any = null;
    let sourceDesc = '';
    if (hasSource) {
        try {
            sourceItem = await meli.getItem(source_marketplace_id, source_item_id);
            sourceDesc = await meli.getDescription(source_marketplace_id, source_item_id);
        } catch {
            // best-effort: fallback a manual_product/artículo si existe
        }
    }

    const srcAttr = (id: string) =>
        sourceItem?.attributes?.find((a: any) => a?.id === id)?.value_name ?? '';
    const parseDim = (s: any) => {
        const m = s == null ? null : String(s).match(/-?\d+(\.\d+)?/);
        return m ? Number(m[0]) : undefined;
    };
    const srcDims = sourceItem?.shipping?.dimensions;
    const toOptNum = (v: any) => (v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : undefined);

    const merged = {
        nombre: ficha?.nombre_producto || manual_product?.nombre || sourceItem?.family_name || sourceItem?.title || articulo?.nombre || '',
        marca: ficha?.marca || manual_product?.marca || srcAttr('BRAND') || articulo?.marca || '',
        modelo: ficha?.modelo || manual_product?.modelo || srcAttr('MODEL') || articulo?.modelo || '',
        variante: ficha?.variante || manual_product?.variante || srcAttr('COLOR') || articulo?.variante || '',
        categoria: ficha?.categoria || category_id || sourceItem?.category_id || articulo?.categoria || '',
        descripcion: ficha?.descripcion_larga || ficha?.descripcion || manual_product?.descripcion || sourceDesc || articulo?.descripcion || '',
        atributos_especificos: articulo?.atributos_especificos || {},
        bullet_points: ficha?.bullet_points || [],
        palabras_clave: ficha?.palabras_clave || [],
        materiales: ficha?.materiales || srcAttr('MATERIAL') || articulo?.materiales || '',
        peso_kg: ficha?.peso_kg ?? toOptNum(manual_product?.peso_kg) ?? (srcDims?.weight != null ? Number(srcDims.weight) / 1000 : (parseDim(srcAttr('SELLER_PACKAGE_WEIGHT')) != null ? parseDim(srcAttr('SELLER_PACKAGE_WEIGHT'))! / 1000 : undefined)) ?? articulo?.peso_kg,
        largo_cm: ficha?.largo_cm ?? toOptNum(manual_product?.largo_cm) ?? toOptNum(srcDims?.length) ?? parseDim(srcAttr('SELLER_PACKAGE_LENGTH')) ?? articulo?.largo_cm,
        ancho_cm: ficha?.ancho_cm ?? toOptNum(manual_product?.ancho_cm) ?? toOptNum(srcDims?.width) ?? parseDim(srcAttr('SELLER_PACKAGE_WIDTH')) ?? articulo?.ancho_cm,
        alto_cm: ficha?.alto_cm ?? toOptNum(manual_product?.alto_cm) ?? toOptNum(srcDims?.height) ?? parseDim(srcAttr('SELLER_PACKAGE_HEIGHT')) ?? articulo?.alto_cm,
        pais_origen: ficha?.pais_origen || srcAttr('ORIGIN_COUNTRY') || articulo?.pais_origen || '',
        codigo_universal: ficha?.codigo_universal || manual_product?.codigo_universal || srcAttr('GTIN') || srcAttr('EAN') || articulo?.codigo_universal || '',
    };

    const result = await generateListingContent(merged, {
        marketplace_id,
        categoria: category_id || merged.categoria,
    });

    // Rellenar características secundarias SOLO con datos reales (determinístico, sin alucinar).
    let attributes: Array<{ id: string; value_name?: string; value_id?: string }> = [];
    if (category_id && marketplace_id) {
        try {
            const attrInfo = await (meli as any).getCategoryAttributes(marketplace_id, category_id);
            const optional = filterOptionalAttrs(attrInfo.optional || []);
            attributes = fillOptionalFromData(optional, merged);
        } catch (e: any) {
            console.error('[ai-complete] Error rellenando secundarias:', e.message);
        }
    }

    return NextResponse.json({ ok: true, ...result, attributes });
}
