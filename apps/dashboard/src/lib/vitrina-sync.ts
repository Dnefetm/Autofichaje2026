/**
 * vitrina-sync.ts — Motor de sincronización de cambios de una vidriera hacia MeLi.
 *
 * Recibe { field, value }[], valida contra el esquema declarativo, agrupa los campos
 * por mecanismo real de MeLi (mínimo de llamadas) y persiste el write-back local.
 * Los fallos se aíslan por campo: si el título lo rechaza MeLi, marca y stock igual
 * se aplican y se reporta el error solo para el título.
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

    // 4. Agrupar por mecanismo MeLi
    const itemPatch: Record<string, any> = {};
    const attributes: any[] = [];
    const saleTerms: any[] = [];
    const itemFields: string[] = [];
    const priceFields: Array<{ field: string; value: number }> = [];
    const stockFields: Array<{ field: string; value: number }> = [];
    const statusFields: Array<{ field: string; value: string }> = [];
    const listingTypeFields: Array<{ field: string; value: string }> = [];
    const descFields: Array<{ field: string; value: string }> = [];

    for (const a of accepted) {
        const f = getField(a.field)!;
        const patch = f.toMeliPatch(a.value, ctx);
        switch (f.writeKind) {
            case 'title':
            case 'shipping':
            case 'sku':
            case 'pictures':
                Object.assign(itemPatch, patch);
                itemFields.push(a.field);
                break;
            case 'attribute':
                attributes.push(patch);
                itemFields.push(a.field);
                break;
            case 'saleTerm':
                saleTerms.push(patch);
                itemFields.push(a.field);
                break;
            case 'price':
                priceFields.push({ field: a.field, value: Number(a.value) });
                break;
            case 'stock':
                stockFields.push({ field: a.field, value: Math.max(0, Math.floor(Number(a.value))) });
                break;
            case 'status':
                statusFields.push({ field: a.field, value: String(a.value) });
                break;
            case 'listingType':
                listingTypeFields.push({ field: a.field, value: String(a.value) });
                break;
            case 'description':
                descFields.push({ field: a.field, value: String(a.value) });
                break;
        }
    }

    // 5a. PUT /items/{id} único (title/shipping/sku/pictures/attribute/saleTerm)
    if (itemFields.length > 0) {
        const body: Record<string, any> = { ...itemPatch };
        if (attributes.length > 0) body.attributes = attributes;
        if (saleTerms.length > 0) body.sale_terms = saleTerms;
        try {
            await (meli as any).updateItem(accountId, itemId, body);
            itemFields.forEach(ok);
        } catch (e: any) {
            itemFields.forEach((f) => fail(f, readableError(e, 'MeLi rechazó el cambio')));
        }
    }

    // 5b. Precio (variante-aware)
    for (const p of priceFields) {
        const res = await (meli as any).updatePrice(accountId, [{ itemId, variationId, price: p.value }]);
        const r = Array.isArray(res) ? res[0] : res;
        if (r?.status === 'error') fail(p.field, readableError(r?.error, 'MeLi rechazó el precio'));
        else ok(p.field);
    }

    // 5c. Stock
    for (const s of stockFields) {
        const res = await (meli as any).updateStock(accountId, [{ itemId, variationId, quantity: s.value }]);
        const r = Array.isArray(res) ? res[0] : res;
        if (r?.status === 'error') fail(s.field, readableError(r?.error, 'MeLi rechazó el stock'));
        else ok(s.field);
    }

    // 5d. Estado (pausar/activar)
    for (const s of statusFields) {
        try {
            if (s.value === 'paused') await (meli as any).pauseListing(accountId, itemId);
            else await (meli as any).activateListing(accountId, itemId);
            ok(s.field);
        } catch (e: any) {
            fail(s.field, readableError(e, 'MeLi rechazó el cambio de estado'));
        }
    }

    // 5e. Comisión (listing_type)
    for (const l of listingTypeFields) {
        try {
            await (meli as any).updateListingType(accountId, itemId, l.value);
            ok(l.field);
        } catch (e: any) {
            fail(l.field, readableError(e, 'MeLi rechazó el cambio de comisión'));
        }
    }

    // 5f. Descripción (PUT si ya existe, POST si no)
    for (const d of descFields) {
        try {
            if (ctx.description) await (meli as any).updateDescription(accountId, itemId, d.value);
            else await (meli as any).addDescription(accountId, itemId, d.value);
            ok(d.field);
        } catch (e: any) {
            fail(d.field, readableError(e, 'MeLi rechazó la descripción'));
        }
    }

    // 6. Write-back local solo de los campos aceptados
    const dbUpdate: Record<string, any> = {};
    for (const a of accepted) {
        if (!okSet.has(a.field)) continue;
        const f = getField(a.field);
        for (const col of f?.dbColumns || []) {
            dbUpdate[col] = a.value;
        }
    }
    if (Object.keys(dbUpdate).length > 0) {
        dbUpdate.actualizado_el = new Date().toISOString();
        await supabaseAdmin.from('publicaciones_externas').update(dbUpdate).eq('id', pubId);
    }

    return { ok: true, applied: results };
}
