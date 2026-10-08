/**
 * vitrina-sync.ts — Motor de sincronización de cambios de una vidriera hacia MeLi.
 *
 * Recibe { field, value }[], valida contra el esquema declarativo, ejecuta CADA
 * campo con el mecanismo real de MeLi (no un PUT genérico) y persiste el write-back
 * local. Los fallos se aíslan por campo: si el título lo rechaza MeLi, precio y
 * stock igualmente se aplican y se reporta el error solo para el título.
 */

import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';
import { getField, FieldChange, FieldContext } from './vitrina-fields';

export interface FieldResult {
    field: string;
    ok: boolean;
    error?: string;
}

export interface ApplyResult {
    ok: boolean;
    applied: FieldResult[];
}

function readableError(e: any, fallback: string): string {
    const msg =
        e?.response?.data?.message ||
        e?.response?.data?.error ||
        e?.message ||
        fallback;
    return typeof msg === 'string' ? msg : JSON.stringify(msg);
}

export async function applyVitrinaChanges(
    pubId: string,
    changes: FieldChange[],
): Promise<ApplyResult> {
    // 1. Leer la publicación local
    const { data: pub, error: pubErr } = await supabaseAdmin
        .from('publicaciones_externas')
        .select('*')
        .eq('id', pubId)
        .single();
    if (pubErr || !pub) throw new Error('Publicación no encontrada');

    const meli = new MeliAdapter();
    const accountId = pub.marketplace_id;
    const itemId = pub.external_item_id;

    // 2. Leer el ítem real en MeLi + su descripción (fuente de verdad para validar)
    const item = await (meli as any).getItem(accountId, itemId);
    let description = '';
    try {
        description = await (meli as any).getDescription(accountId, itemId);
    } catch { /* descripción opcional */ }

    const ctx: FieldContext = {
        item,
        description,
        isCatalog: item.catalog_listing === true || item.listing_type_id === 'gold_product_page',
        soldQuantity: Number(item.sold_quantity ?? 0),
        isUP: item.family_name != null,
    };

    const hasVariation = !!pub.external_variation_id && pub.external_variation_id !== '0';
    const variationId = hasVariation ? pub.external_variation_id : undefined;

    // 3. Validar (sin ejecutar aún)
    const accepted: Array<{ field: string; value: any }> = [];
    const results: FieldResult[] = [];

    for (const ch of changes) {
        const f = getField(ch.field);
        if (!f) {
            results.push({ field: ch.field, ok: false, error: 'Campo desconocido' });
            continue;
        }
        const can = f.canEdit(ctx);
        if (!can.ok) {
            results.push({ field: ch.field, ok: false, error: can.reason });
            continue;
        }
        accepted.push({ field: f.id, value: ch.value });
    }

    const okSet = new Set<string>();
    const ok = (field: string) => { okSet.add(field); results.push({ field, ok: true }); };
    const fail = (field: string, error: string) => { results.push({ field, ok: false, error }); };

    // 4. Ejecutar por mecanismo MeLi (fallos aislados por grupo)

    // 4a. updateItem (título + envío gratis → un único PUT /items)
    const updateItemFields = accepted.filter(a => getField(a.field)!.endpoint === 'updateItem');
    if (updateItemFields.length > 0) {
        const patch: Record<string, any> = {};
        for (const a of updateItemFields) {
            Object.assign(patch, getField(a.field)!.toMeliPatch(a.value, ctx));
        }
        try {
            await (meli as any).updateItem(accountId, itemId, patch);
            updateItemFields.forEach(a => ok(a.field));
        } catch (e: any) {
            updateItemFields.forEach(a => fail(a.field, readableError(e, 'MeLi rechazó el cambio')));
        }
    }

    // 4b. updatePrice
    for (const a of accepted.filter(a => getField(a.field)!.endpoint === 'updatePrice')) {
        const price = Number(a.value);
        const res = await (meli as any).updatePrice(accountId, [{ itemId, variationId, price }]);
        const r = Array.isArray(res) ? res[0] : res;
        if (r?.status === 'error') fail(a.field, readableError(r?.error, 'MeLi rechazó el precio'));
        else ok(a.field);
    }

    // 4c. updateStock
    for (const a of accepted.filter(a => getField(a.field)!.endpoint === 'updateStock')) {
        const quantity = Math.max(0, Math.floor(Number(a.value)));
        const res = await (meli as any).updateStock(accountId, [{ itemId, variationId, quantity }]);
        const r = Array.isArray(res) ? res[0] : res;
        if (r?.status === 'error') fail(a.field, readableError(r?.error, 'MeLi rechazó el stock'));
        else ok(a.field);
    }

    // 4d. updateStatus (pausar/activar)
    for (const a of accepted.filter(a => getField(a.field)!.endpoint === 'updateStatus')) {
        try {
            if (String(a.value) === 'paused') await (meli as any).pauseListing(accountId, itemId);
            else await (meli as any).activateListing(accountId, itemId);
            ok(a.field);
        } catch (e: any) {
            fail(a.field, readableError(e, 'MeLi rechazó el cambio de estado'));
        }
    }

    // 4e. updateListingType (comisión)
    for (const a of accepted.filter(a => getField(a.field)!.endpoint === 'updateListingType')) {
        try {
            await (meli as any).updateListingType(accountId, itemId, String(a.value));
            ok(a.field);
        } catch (e: any) {
            fail(a.field, readableError(e, 'MeLi rechazó el cambio de comisión'));
        }
    }

    // 4f. updateDescription (PUT si ya existe, POST si no)
    for (const a of accepted.filter(a => getField(a.field)!.endpoint === 'updateDescription')) {
        try {
            if (ctx.description) {
                await (meli as any).updateDescription(accountId, itemId, String(a.value));
            } else {
                await (meli as any).addDescription(accountId, itemId, String(a.value));
            }
            ok(a.field);
        } catch (e: any) {
            fail(a.field, readableError(e, 'MeLi rechazó la descripción'));
        }
    }

    // 5. Persistir localmente (write-back) solo los cambios aceptados
    const dbUpdate: Record<string, any> = {};
    for (const a of accepted) {
        if (!okSet.has(a.field)) continue;
        const f = getField(a.field);
        if (!f || !f.dbColumn) continue;
        dbUpdate[f.dbColumn] = a.value;
    }
    if (Object.keys(dbUpdate).length > 0) {
        dbUpdate.actualizado_el = new Date().toISOString();
        await supabaseAdmin.from('publicaciones_externas').update(dbUpdate).eq('id', pubId);
    }

    return { ok: true, applied: results };
}
