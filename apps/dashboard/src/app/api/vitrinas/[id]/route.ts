import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { applyVitrinaChanges } from '@/lib/vitrina-sync';
import { registrarAuditoria } from '@/lib/auditoria';
import { extractFiscalFromMeliAttributes, isValidSatKey } from '@/lib/meli-fiscal';

export const dynamic = 'force-dynamic';

/**
 * GET /api/vitrinas/[id]
 * Devuelve el contexto de edición en UNA sola carga: ítem real de MeLi +
 * descripción + metadatos de atributos de categoría + datos fiscales SAT/CFDI.
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
            fiscal: extractFiscalFromMeliAttributes(item?.attributes),
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
 * - action === 'sync_sat_to_articulo': guarda codigo_sat en articulos (origin: 'web')
 * - changes: [{ field, value }, ...]: valida contra esquema declarativo y sincroniza a MeLi
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const body = await req.json().catch(() => null);

    if (body?.action === 'sync_sat_to_articulo') {
        const articuloId = String(body?.articulo_id ?? '').trim();
        const satVal = String(body?.codigo_sat ?? '').trim();
        if (!articuloId) {
            return NextResponse.json({ ok: false, error: 'articulo_id requerido' }, { status: 400 });
        }
        if (!isValidSatKey(satVal)) {
            return NextResponse.json({ ok: false, error: 'La clave SAT debe tener exactamente 8 dígitos numéricos' }, { status: 400 });
        }
        try {
            const { data: updatedArt, error: updErr } = await supabaseAdmin
                .from('articulos')
                .update({ codigo_sat: satVal, origin: 'web' })
                .eq('articulo_id', articuloId)
                .select('articulo_id, codigo_sat')
                .single();
            if (updErr || !updatedArt) {
                return NextResponse.json({ ok: false, error: updErr?.message || 'Artículo no encontrado' }, { status: updErr ? 500 : 404 });
            }
            await registrarAuditoria(id, 'publicacion', 'edicion_sat_desde_vitrina', {
                articulo_id: articuloId,
                codigo_sat: satVal,
            });
            return NextResponse.json({ ok: true, articulo_id: updatedArt.articulo_id, codigo_sat: updatedArt.codigo_sat });
        } catch (err: any) {
            return NextResponse.json({ ok: false, error: err?.message || 'Error al guardar SAT en catálogo' }, { status: 500 });
        }
    }

    const changes = body?.changes;

    if (!Array.isArray(changes) || changes.length === 0) {
        return NextResponse.json({ ok: false, error: 'Se requiere changes: [{field, value}]' }, { status: 400 });
    }

    try {
        const result = await applyVitrinaChanges(id, changes);
        const huboCambios = Array.isArray(result.applied) && result.applied.some((a: any) => a.ok);
        if (huboCambios) {
            await registrarAuditoria(id, 'publicacion', 'edicion_campos', { campos: changes.map((c: any) => c.field) });
        }

        let sat_articulo_synced = false;
        let sat_articulo_error: string | undefined;
        if (body?.sync_sat_to_articulo === true && body?.articulo_id) {
            const satChange = changes.find((c: any) => c?.field === 'sat_key');
            const satResult = Array.isArray(result.applied)
                ? result.applied.find((a: any) => a.field === 'sat_key')
                : null;
            if (satChange && satResult?.ok) {
                const satVal = String(satChange.value ?? '').trim();
                const articuloId = String(body.articulo_id).trim();
                if (isValidSatKey(satVal) && articuloId) {
                    const { error: satErr } = await supabaseAdmin
                        .from('articulos')
                        .update({ codigo_sat: satVal, origin: 'web' })
                        .eq('articulo_id', articuloId);
                    if (satErr) {
                        sat_articulo_error = satErr.message;
                    } else {
                        sat_articulo_synced = true;
                        await registrarAuditoria(id, 'publicacion', 'edicion_sat_desde_vitrina', {
                            articulo_id: articuloId,
                            codigo_sat: satVal,
                        });
                    }
                }
            }
        }

        return NextResponse.json({
            ...result,
            ...(sat_articulo_synced ? { sat_articulo_synced: true } : {}),
            ...(sat_articulo_error ? { sat_articulo_error } : {}),
        });
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
