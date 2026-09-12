import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { resolvePublicationAI } from '@gestor/sync/meli-ai-helper';

export const dynamic = 'force-dynamic';

/**
 * POST /api/catalog/external/[id]/improve
 *
 * "Mejorar publicación existente": toma una vidriera ya publicada y le aplica
 * mejoras SIN crear una nueva:
 *   - regenera título + descripción con la IA (voz de marca configurada),
 *   - rellena GTIN y dimensiones de paquete desde la ficha técnica si hay datos
 *     más nuevos/completos que los del ítem actual.
 *
 * Body: { dry_run?: boolean }  (dry_run por defecto true: muestra el diff y no aplica)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run !== false;

    try {
        // 1. Publicación local
        const { data: pub, error: pubErr } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('id, marketplace_id, external_item_id, category_id, listing_type_id, tipo_publicacion, condition, shipping_mode, free_shipping, id_producto_catalogo, esta_mapeado')
            .eq('id', id)
            .single();
        if (pubErr || !pub) return NextResponse.json({ ok: false, error: 'Publicación no encontrada' }, { status: 404 });

        const meli = new MeliAdapter();

        // 2. Ítem actual desde MeLi (fuente de verdad)
        const item = await (meli as any).getItem(pub.marketplace_id, pub.external_item_id);
        const attrVal = (aid: string) => item.attributes?.find((a: any) => a.id === aid)?.value_name ?? null;

        // 3. Artículo mapeado → ficha técnica (datos más nuevos/completos)
        let ficha: any = null;
        const { data: mapRow } = await supabaseAdmin
            .from('mapeo_publicacion_articulo')
            .select('articulo_id')
            .eq('publicacion_id', id)
            .limit(1)
            .maybeSingle();
        if (mapRow?.articulo_id) {
            const { data: f } = await supabaseAdmin
                .from('fichas_tecnicas')
                .select('id, nombre_producto, descripcion, descripcion_larga, marca, modelo, codigo_universal, peso_kg, largo_cm, ancho_cm, alto_cm, materiales')
                .eq('articulo_id', mapRow.articulo_id)
                .order('updated_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            ficha = f;
        }

        // 4. Modelo de seller (UP vs legacy)
        const seller = await (meli as any).detectSellerModel(pub.marketplace_id);
        const isLegacy = seller.model !== 'up';

        const currentTitle = item.family_name || item.title || '';
        const currentDesc = await (meli as any).getDescription(pub.marketplace_id, pub.external_item_id);

        // 5. Regenerar título + descripción con la IA (voz de marca)
        const ai = await resolvePublicationAI({
            nombre: currentTitle,
            marca: attrVal('BRAND') || ficha?.marca || '',
            modelo: attrVal('MODEL') || ficha?.modelo || '',
            descripcion: ficha?.descripcion_larga || ficha?.descripcion || currentDesc || '',
            unresolved_attributes: [],
            max_family_name_chars: isLegacy ? 60 : 50,
            legacy: isLegacy,
            rephrase_description: true,
        }, { marketplace_id: pub.marketplace_id, categoria: pub.category_id });

        // 6. Mejoras de identificación/dimensiones desde la ficha (solo si hay datos)
        const changes: Array<{ id: string; antes: string | null; despues: string | null }> = [];
        const improvedAttrs: Array<{ id: string; value_name?: string; value_id?: string }> = [];

        // GTIN: ficha > item (si difieren)
        const currentGtin = attrVal('GTIN') || attrVal('EAN') || attrVal('UPC');
        if (ficha?.codigo_universal && ficha.codigo_universal !== currentGtin) {
            changes.push({ id: 'GTIN', antes: currentGtin, despues: ficha.codigo_universal });
            improvedAttrs.push({ id: 'GTIN', value_name: ficha.codigo_universal });
        }

        // Dimensiones de paquete: ficha (si hay) vs atributos actuales
        const pkgNum = (aid: string) => {
            const raw = attrVal(aid);
            const m = raw ? String(raw).match(/-?\d+(\.\d+)?/) : null;
            return m ? Number(m[0]) : null;
        };
        const dimsMejora = (() => {
            const out: Array<{ id: string; value_name: string }> = [];
            if (ficha?.largo_cm != null) out.push({ id: 'SELLER_PACKAGE_LENGTH', value_name: `${Math.round(ficha.largo_cm)} cm` });
            if (ficha?.ancho_cm != null) out.push({ id: 'SELLER_PACKAGE_WIDTH', value_name: `${Math.round(ficha.ancho_cm)} cm` });
            if (ficha?.alto_cm != null) out.push({ id: 'SELLER_PACKAGE_HEIGHT', value_name: `${Math.round(ficha.alto_cm)} cm` });
            if (ficha?.peso_kg != null) out.push({ id: 'SELLER_PACKAGE_WEIGHT', value_name: `${Math.round(ficha.peso_kg * 1000)} g` });
            return out;
        })();
        for (const d of dimsMejora) {
            const antes = attrVal(d.id);
            if (antes && String(antes).replace(/\s+/g, '') === d.value_name.replace(/\s+/g, '')) continue; // sin cambio
            changes.push({ id: d.id, antes: antes, despues: d.value_name });
            improvedAttrs.push(d);
        }

        const diff = {
            titulo: { antes: currentTitle, despues: isLegacy ? ai.title : ai.family_name },
            descripcion: { antes: currentDesc || '', despues: ai.description || '' },
            atributos: changes,
        };

        // 7. DRY RUN: retornar diff sin aplicar
        if (dry_run) {
            return NextResponse.json({
                ok: true,
                dry_run: true,
                mensaje: 'Vista previa de mejoras. Para aplicar envía dry_run: false.',
                diff,
                profiles: ai.profiles ?? null,
                tiene_ficha: !!ficha,
            });
        }

        // 8. Aplicar: PUT título + atributos mejorados, y PUT descripción
        const updateBody: any = {
            ...(isLegacy ? { title: ai.title } : { family_name: ai.family_name }),
            ...(improvedAttrs.length ? { attributes: improvedAttrs } : {}),
        };
        const updated = await (meli as any).updateItem(pub.marketplace_id, pub.external_item_id, updateBody);

        let descUpdated = false;
        if (ai.description) {
            await (meli as any).addDescription(pub.marketplace_id, pub.external_item_id, ai.description);
            descUpdated = true;
        }

        // Persistir título/descripción localmente
        await supabaseAdmin
            .from('publicaciones_externas')
            .update({ titulo: updated.title || updated.title_generated || ai.title, actualizado_el: new Date().toISOString() })
            .eq('id', id);

        return NextResponse.json({
            ok: true,
            item_id: pub.external_item_id,
            permalink: updated.permalink || item.permalink || null,
            descripcion_actualizada: descUpdated,
            diff,
        });
    } catch (err: any) {
        const errMsg: string = err.message || '';
        let meliError: any = null;
        let isMeliValidation = false;
        if (errMsg.includes('400') || errMsg.includes('validation_error')) {
            try {
                const jsonStart = errMsg.indexOf('{');
                if (jsonStart !== -1) meliError = JSON.parse(errMsg.slice(jsonStart));
                isMeliValidation = true;
            } catch { /* cae al 500 genérico */ }
        }
        if (isMeliValidation) {
            return NextResponse.json({ ok: false, error: 'MeLi rechazó la mejora (validation_error)', meli_error: meliError }, { status: 422 });
        }
        return NextResponse.json({ ok: false, error: errMsg }, { status: 500 });
    }
}
