import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { resolvePublicationAI } from '@gestor/sync/meli-ai-helper';

export const dynamic = 'force-dynamic';

/**
 * POST /api/catalog/external/[id]/improve
 *
 * "Mejorar publicación existente": compara el ítem de MeLi contra 3 fuentes
 * (mi catálogo > ficha técnica > publicación de catálogo MeLi) y propone, campo
 * por campo, rellenar o sustituir. El usuario aprueba cada campo (como en el
 * modal "Enriquecer desde catálogo" de fichas). Nada se aplica automáticamente.
 *
 * Body:
 *   dry_run: true  → calcula y devuelve propuestas (default)
 *   dry_run: false → { campos_aceptados: { campo: valor }, imagenes?: string[] }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run !== false;

    try {
        // 1. Publicación local
        const { data: pub, error: pubErr } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('id, marketplace_id, external_item_id, category_id, id_producto_catalogo, tipo_publicacion')
            .eq('id', id)
            .single();
        if (pubErr || !pub) return NextResponse.json({ ok: false, error: 'Publicación no encontrada' }, { status: 404 });

        const meli = new MeliAdapter();

        // 2. Ítem actual desde MeLi
        const item = await (meli as any).getItem(pub.marketplace_id, pub.external_item_id);
        const itemAttr = (aid: string) => item.attributes?.find((a: any) => a.id === aid)?.value_name ?? null;
        const itemDesc = await (meli as any).getDescription(pub.marketplace_id, pub.external_item_id);
        const itemPictures: string[] = (item.pictures || []).map((p: any) => p.secure_url || p.url).filter(Boolean);
        const tieneVentas = (item.sold_quantity ?? 0) > 0;

        // 3. Fuentes (prioridad: catálogo > ficha > catálogo MeLi)
        let articulo: any = null;
        let ficha: any = null;
        let catalogoMeli: any = null;

        const { data: mapRow } = await supabaseAdmin
            .from('mapeo_publicacion_articulo')
            .select('articulo_id')
            .eq('publicacion_id', id)
            .limit(1)
            .maybeSingle();

        if (mapRow?.articulo_id) {
            const { data: a } = await supabaseAdmin
                .from('articulos')
                .select('nombre, marca, modelo, codigo_universal, materiales, peso_kg, largo_cm, ancho_cm, alto_cm, descripcion, imagenes')
                .eq('articulo_id', mapRow.articulo_id)
                .single();
            articulo = a;
            const { data: f } = await supabaseAdmin
                .from('fichas_tecnicas')
                .select('nombre_producto, descripcion, descripcion_larga, marca, modelo, codigo_universal, materiales, peso_kg, largo_cm, ancho_cm, alto_cm')
                .eq('articulo_id', mapRow.articulo_id)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            ficha = f;
        }

        if (pub.id_producto_catalogo) {
            catalogoMeli = await (meli as any).getCatalogProduct(pub.marketplace_id, pub.id_producto_catalogo);
        }

        const catAttr = (aid: string) => catalogoMeli?.attributes?.find((a: any) => a.id === aid)?.value_name ?? null;

        // Resolver valor de una fuente para un campo (retorna { valor, fuente })
        function mejorValor(campo: string): { valor: any; fuente: 'catalogo' | 'ficha' | 'catalogo_meli' } | null {
            const pick = (val: any, fuente: any) => (val === null || val === undefined || val === '' ? null : { valor: val, fuente });
            switch (campo) {
                case 'GTIN': return pick(articulo?.codigo_universal, 'catalogo') ?? pick(ficha?.codigo_universal, 'ficha') ?? pick(catAttr('GTIN') || catAttr('EAN') || catAttr('UPC'), 'catalogo_meli');
                case 'BRAND': return pick(articulo?.marca, 'catalogo') ?? pick(ficha?.marca, 'ficha') ?? pick(catAttr('BRAND'), 'catalogo_meli');
                case 'MODEL': return pick(articulo?.modelo, 'catalogo') ?? pick(ficha?.modelo, 'ficha') ?? pick(catAttr('MODEL'), 'catalogo_meli');
                case 'SELLER_SKU': return pick(articulo?.modelo, 'catalogo') ?? pick(item?.seller_custom_field, 'catalogo_meli');
                case 'MATERIAL': return pick(articulo?.materiales, 'catalogo') ?? pick(ficha?.materiales, 'ficha') ?? pick(catAttr('MATERIAL'), 'catalogo_meli');
                case 'SELLER_PACKAGE_WEIGHT': {
                    const a = articulo?.peso_kg != null ? `${Math.round(articulo.peso_kg * 1000)} g` : null;
                    const f = ficha?.peso_kg != null ? `${Math.round(ficha.peso_kg * 1000)} g` : null;
                    return pick(a, 'catalogo') ?? pick(f, 'ficha') ?? pick(catAttr('SELLER_PACKAGE_WEIGHT'), 'catalogo_meli');
                }
                case 'SELLER_PACKAGE_LENGTH': {
                    const a = articulo?.largo_cm != null ? `${Math.round(articulo.largo_cm)} cm` : null;
                    const f = ficha?.largo_cm != null ? `${Math.round(ficha.largo_cm)} cm` : null;
                    return pick(a, 'catalogo') ?? pick(f, 'ficha') ?? pick(catAttr('SELLER_PACKAGE_LENGTH'), 'catalogo_meli');
                }
                case 'SELLER_PACKAGE_WIDTH': {
                    const a = articulo?.ancho_cm != null ? `${Math.round(articulo.ancho_cm)} cm` : null;
                    const f = ficha?.ancho_cm != null ? `${Math.round(ficha.ancho_cm)} cm` : null;
                    return pick(a, 'catalogo') ?? pick(f, 'ficha') ?? pick(catAttr('SELLER_PACKAGE_WIDTH'), 'catalogo_meli');
                }
                case 'SELLER_PACKAGE_HEIGHT': {
                    const a = articulo?.alto_cm != null ? `${Math.round(articulo.alto_cm)} cm` : null;
                    const f = ficha?.alto_cm != null ? `${Math.round(ficha.alto_cm)} cm` : null;
                    return pick(a, 'catalogo') ?? pick(f, 'ficha') ?? pick(catAttr('SELLER_PACKAGE_HEIGHT'), 'catalogo_meli');
                }
                case 'descripcion': {
                    const a = articulo?.descripcion || null;
                    const f = ficha?.descripcion_larga || ficha?.descripcion || null;
                    return pick(f, 'ficha') ?? pick(a, 'catalogo');
                }
                case 'titulo': {
                    const a = articulo?.nombre || null;
                    const f = ficha?.nombre_producto || null;
                    return pick(f, 'ficha') ?? pick(a, 'catalogo');
                }
                default: return null;
            }
        }

        const FUENTE_LABEL = { catalogo: 'Mi catálogo', ficha: 'Ficha técnica', catalogo_meli: 'Catálogo MeLi' } as const;

        // --- Identificación (campos editables con sugerencia) ---
        const IDENTIFICACION: Array<{ campo: string; label: string }> = [
            { campo: 'GTIN', label: 'Código universal (GTIN)' },
            { campo: 'BRAND', label: 'Marca' },
            { campo: 'MODEL', label: 'Modelo' },
            { campo: 'SELLER_SKU', label: 'SKU' },
            { campo: 'titulo', label: 'Título' },
        ];
        const identificacion = IDENTIFICACION.map(d => {
            const actual = d.campo === 'titulo'
                ? (item.family_name || item.title || '')
                : (d.campo === 'SELLER_SKU' ? (item.seller_custom_field || '') : (itemAttr(d.campo) || ''));
            const mejor = mejorValor(d.campo);
            return {
                campo: d.campo,
                label: d.label,
                actual: actual || '',
                sugerido: mejor?.valor ?? null,
                fuente_label: mejor ? FUENTE_LABEL[mejor.fuente] : null,
                restringido: d.campo === 'titulo' && tieneVentas,
            };
        });

        // --- Descripción (fuentes disponibles) ---
        const descripcion = {
            actual: itemDesc || '',
            catalogo: articulo?.descripcion || '',
            ficha: (ficha?.descripcion_larga || ficha?.descripcion) || '',
        };

        // --- Características (atributos de categoría, primarias y secundarias) ---
        const IDENT_IDS = new Set(['GTIN', 'EAN', 'UPC', 'BRAND', 'MODEL', 'SELLER_SKU', 'SELLER_CUSTOM_FIELD', 'ITEM_CONDITION']);
        let caracteristicas: any[] = [];
        if (pub.category_id) {
            const catAttrs = await (meli as any).getCategoryAttributes(pub.marketplace_id, pub.category_id).catch(() => null);
            const itemAttrMap: Map<string, any> = new Map((item.attributes || []).map((a: any) => [a.id, a]));
            caracteristicas = (catAttrs?.raw || []).filter((a: any) => a.id && !IDENT_IDS.has(a.id)).map((a: any) => {
                const cur = itemAttrMap.get(a.id);
                return {
                    id: a.id,
                    name: a.name || a.id,
                    type: a.value_type || a.type || 'string',
                    values: Array.isArray(a.values) ? a.values.map((v: any) => ({ id: v.id, name: v.name })) : [],
                    required: !!(a.tags || {}).required,
                    value_name: cur?.value_name ?? '',
                    value_id: cur?.value_id ?? null,
                };
            });
        }

        // Imágenes sugeridas (por fuente)
        const imagenesSugeridas: Array<{ url: string; fuente: string }> = [];
        const seen = new Set(itemPictures);
        const artImgs: string[] = (articulo?.imagenes || []).map((p: any) => String(p)).filter((u: string) => u.startsWith('http') && !seen.has(u));
        for (const u of artImgs) { imagenesSugeridas.push({ url: u, fuente: 'Mi catálogo' }); seen.add(u); }
        for (const p of (catalogoMeli?.pictures || [])) {
            const u = p.secure_url || p.url;
            if (u && !seen.has(u)) { imagenesSugeridas.push({ url: u, fuente: 'Catálogo MeLi' }); seen.add(u); }
        }

        // (botón por campo) Mejorar descripción con IA aplicando el prompt de voz de marca.
        if (body.combinar_descripcion) {
            const baseDesc = ficha?.descripcion_larga || ficha?.descripcion || articulo?.descripcion || itemDesc || '';
            const ai = await resolvePublicationAI({
                nombre: item.family_name || item.title || '',
                marca: itemAttr('BRAND') || ficha?.marca || '',
                modelo: itemAttr('MODEL') || ficha?.modelo || '',
                descripcion: baseDesc,
                unresolved_attributes: [],
                max_family_name_chars: 50,
                legacy: false,
                rephrase_description: true,
            }, { marketplace_id: pub.marketplace_id, categoria: pub.category_id });
            return NextResponse.json({ ok: true, descripcion_mejorada: ai.description || baseDesc, perfiles: ai.profiles ?? null });
        }

        // 4. DRY RUN: devolver todo
        if (dry_run) {
            return NextResponse.json({
                ok: true,
                dry_run: true,
                identificacion,
                descripcion,
                caracteristicas,
                titulo_restringido: tieneVentas,
                imagenes_actuales: itemPictures,
                imagenes_sugeridas: imagenesSugeridas,
            });
        }

        // 5. APLICAR: solo lo aceptado
        const camposAceptados: Record<string, string> = body.campos_aceptados || {};
        const imagenes: string[] | undefined = Array.isArray(body.imagenes) ? body.imagenes : undefined;

        // Cualquier campo que no sea título/descripción se trata como atributo
        // (permite editar características primarias y secundarias libremente).
        const NO_ATTR = new Set(['titulo', 'descripcion']);
        const attributes = Object.entries(camposAceptados)
            .filter(([campo, valor]) => !NO_ATTR.has(campo) && valor)
            .map(([campo, valor]) => ({ id: campo, value_name: String(valor) }));

        const seller = await (meli as any).detectSellerModel(pub.marketplace_id);
        const isLegacy = seller.model !== 'up';

        const updateBody: any = {};
        if (attributes.length) updateBody.attributes = attributes;
        if (camposAceptados.titulo) {
            if (isLegacy) updateBody.title = camposAceptados.titulo;
            else updateBody.family_name = camposAceptados.titulo;
        }
        if (imagenes && imagenes.length) updateBody.pictures = imagenes.map((u: string) => ({ source: u }));

        let aplicados = 0;
        if (Object.keys(updateBody).length > 0) {
            await (meli as any).updateItem(pub.marketplace_id, pub.external_item_id, updateBody);
            aplicados++;
        }
        if (camposAceptados.descripcion) {
            await (meli as any).addDescription(pub.marketplace_id, pub.external_item_id, camposAceptados.descripcion);
            aplicados++;
        }

        return NextResponse.json({ ok: true, item_id: pub.external_item_id, aplicados, campos: Object.keys(camposAceptados) });
    } catch (err: any) {
        const errMsg: string = err.message || '';
        let meliError: any = null;
        let isMeliValidation = false;
        if (errMsg.includes('400') || errMsg.includes('validation_error')) {
            try {
                const jsonStart = errMsg.indexOf('{');
                if (jsonStart !== -1) meliError = JSON.parse(errMsg.slice(jsonStart));
                isMeliValidation = true;
            } catch { /* cae al 500 */ }
        }
        if (isMeliValidation) {
            return NextResponse.json({ ok: false, error: 'MeLi rechazó la mejora (validation_error)', meli_error: meliError }, { status: 422 });
        }
        return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
    }
}
