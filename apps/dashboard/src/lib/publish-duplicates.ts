/**
 * Utilidades compartidas (cliente-safe) para:
 *  1) Semáforo de duplicados de 3 niveles por cuenta (free / warning / exact)
 *  2) Normalización de GTINs múltiples y extracción de capacidades GTIN por categoría MeLi
 *
 * IMPORTANTE: Este archivo NO debe importar módulos server-only (como supabaseAdmin)
 * porque componentes `"use client"` importan `normalizeGtins` y los tipos desde aquí.
 */

export type DuplicateLevel = 'free' | 'warning' | 'exact';

export type MatchReason =
    | 'exact_articulo'
    | 'exact_sku'
    | 'exact_gtin_no_sku'
    | 'different_listing_type'
    | 'different_pack'
    | 'shared_gtin';

export interface DuplicateMatchItem {
    external_item_id: string;
    titulo: string;
    status_externo: string;
    listing_type_id: string | null;
    tipo_publicacion: string | null;
    seller_sku: string | null;
    gtin: string | null;
    precio_venta: number | null;
    permalink: string | null;
    cantidad_requerida: number | null;
    match_reason: MatchReason;
}

export interface AccountDuplicateStatus {
    marketplace_id: string;
    level: DuplicateLevel;
    matches: DuplicateMatchItem[];
    summary: string;
}

export interface CategoryGtinCaps {
    has_gtin: boolean;
    multivalued: boolean;
    gtin_required: boolean;
    has_empty_reason: boolean;
    empty_reasons: Array<{ id: string; name: string }>;
    supports_is_kit: boolean;
}

const SKU_BASURA_RE = /^[0-9a-f]{8}$/i;
const VALID_GTIN_RE = /^\d{8,14}$/;

/** Separa por comas, punto y coma o espacios; limpia y valida formato numérico (8–14 dígitos). */
export function normalizeGtins(raw: string | null | undefined): {
    list: string[];
    joined: string;
    invalid: string[];
} {
    if (!raw || typeof raw !== 'string') {
        return { list: [], joined: '', invalid: [] };
    }
    const tokens = raw
        .split(/[\s,;]+/)
        .map(t => t.trim())
        .filter(Boolean);

    const list: string[] = [];
    const invalid: string[] = [];
    const seen = new Set<string>();

    for (const t of tokens) {
        if (VALID_GTIN_RE.test(t)) {
            if (!seen.has(t)) {
                seen.add(t);
                list.push(t);
            }
        } else if (!invalid.includes(t)) {
            invalid.push(t);
        }
    }

    return {
        list,
        joined: list.join(','),
        invalid,
    };
}

/** Extrae las capacidades reales de GTIN / EMPTY_GTIN_REASON / IS_KIT de los atributos de una categoría MeLi. */
export function extractGtinCaps(rawAttrs: any[]): CategoryGtinCaps {
    const attrs = Array.isArray(rawAttrs) ? rawAttrs : [];
    const gtin = attrs.find((a: any) => a?.id === 'GTIN');
    const empty = attrs.find((a: any) => a?.id === 'EMPTY_GTIN_REASON');
    const isKit = attrs.find((a: any) => a?.id === 'IS_KIT');

    return {
        has_gtin: Boolean(gtin),
        multivalued: Boolean(gtin?.tags?.multivalued),
        gtin_required: Boolean(gtin?.tags?.required || gtin?.tags?.conditional_required),
        has_empty_reason: Boolean(empty),
        empty_reasons: Array.isArray(empty?.values)
            ? empty.values.map((v: any) => ({ id: String(v.id), name: String(v.name) }))
            : [],
        supports_is_kit: Boolean(isKit),
    };
}

function isExactReason(reason: MatchReason): boolean {
    return reason === 'exact_articulo' || reason === 'exact_sku' || reason === 'exact_gtin_no_sku';
}

function formatSummary(level: DuplicateLevel, matches: DuplicateMatchItem[]): string {
    if (level === 'free' || matches.length === 0) return 'Sin publicaciones coincidentes';
    const top = matches[0];
    if (level === 'exact') {
        return `Duplicado exacto: ${top.external_item_id} (${top.listing_type_id || 'sin tipo'}, ${top.status_externo})`;
    }
    if (top.match_reason === 'different_listing_type') {
        return `Existe en otro tipo de listado (${top.listing_type_id || '—'}): ${top.external_item_id}`;
    }
    if (top.match_reason === 'different_pack') {
        return `Existe otra presentación (${top.cantidad_requerida ?? '?'} pzas): ${top.external_item_id}`;
    }
    return `GTIN compartido con ${top.external_item_id}${top.seller_sku ? ` (SKU ${top.seller_sku})` : ''}`;
}

/**
 * Evalúa duplicados por cuenta en `publicaciones_externas` devolviendo semáforo 3 niveles:
 * - 'free' (verde): sin coincidencia activa/pausada/revisión
 * - 'warning' (amarillo): distinto listing_type, distintas piezas o GTIN compartido con otro SKU
 * - 'exact' (rojo): misma cuenta + mismo listing_type + (mismo articulo+piezas, mismo SKU exacto o mismo GTIN sin SKU)
 */
export async function checkPublishDuplicates(
    sb: any,
    input: {
        marketplace_ids: string[];
        articulo_id?: string | null;
        seller_sku?: string | null;
        gtins?: string[];
        listing_type_id?: string | null;
        cantidad_requerida?: number;
    },
): Promise<Record<string, AccountDuplicateStatus>> {
    const accounts = Array.from(new Set((input.marketplace_ids || []).filter(Boolean)));
    const result: Record<string, AccountDuplicateStatus> = {};
    for (const id of accounts) {
        result[id] = {
            marketplace_id: id,
            level: 'free',
            matches: [],
            summary: 'Sin publicaciones coincidentes',
        };
    }
    if (accounts.length === 0) return result;

    const cleanSkuRaw = (input.seller_sku || '').trim();
    const cleanSku = (cleanSkuRaw && !SKU_BASURA_RE.test(cleanSkuRaw)) ? cleanSkuRaw : '';
    const cleanGtins = Array.from(new Set((input.gtins || []).filter(g => VALID_GTIN_RE.test(g))));

    if (!input.articulo_id && !cleanSku && cleanGtins.length === 0) {
        return result;
    }

    type CandidateRow = {
        marketplace_id: string;
        external_item_id: string;
        titulo: string;
        status_externo: string;
        listing_type_id: string | null;
        tipo_publicacion: string | null;
        id_publicacion_padre: string | null;
        par_item_id: string | null;
        seller_sku: string | null;
        gtin: string | null;
        ean: string | null;
        precio_venta: number | null;
        permalink: string | null;
        cantidad_requerida: number | null;
        matched_by: Set<'articulo' | 'sku' | 'gtin'>;
    };

    const byKey = new Map<string, CandidateRow>();
    const mergeRow = (row: any, by: 'articulo' | 'sku' | 'gtin', qty: number | null = null) => {
        if (!row?.marketplace_id || !row?.external_item_id) return;
        const k = `${row.marketplace_id}||${row.external_item_id}`;
        const existing = byKey.get(k);
        if (existing) {
            existing.matched_by.add(by);
            if (qty != null && existing.cantidad_requerida == null) existing.cantidad_requerida = qty;
            return;
        }
        byKey.set(k, {
            marketplace_id: row.marketplace_id,
            external_item_id: row.external_item_id,
            titulo: row.titulo || '',
            status_externo: row.status_externo || 'unknown',
            listing_type_id: row.listing_type_id ?? null,
            tipo_publicacion: row.tipo_publicacion ?? null,
            id_publicacion_padre: row.id_publicacion_padre ?? null,
            par_item_id: row.par_item_id ?? null,
            seller_sku: row.seller_sku ?? null,
            gtin: row.gtin ?? null,
            ean: row.ean ?? null,
            precio_venta: row.precio_venta != null ? Number(row.precio_venta) : null,
            permalink: row.permalink ?? null,
            cantidad_requerida: qty,
            matched_by: new Set([by]),
        });
    };

    const baseCols = 'id, marketplace_id, external_item_id, titulo, status_externo, listing_type_id, tipo_publicacion, id_publicacion_padre, par_item_id, seller_sku, gtin, ean, precio_venta, permalink';

    // Consulta A: por articulo_id mapeado
    if (input.articulo_id) {
        const { data } = await sb
            .from('publicaciones_externas')
            .select(`${baseCols}, mapeo_publicacion_articulo!inner (articulo_id, cantidad_requerida)`)
            .in('marketplace_id', accounts)
            .eq('mapeo_publicacion_articulo.articulo_id', input.articulo_id)
            .in('status_externo', ['active', 'paused', 'under_review'])
            .eq('external_variation_id', '0')
            .limit(40);
        if (Array.isArray(data)) {
            for (const row of data) {
                const maps = Array.isArray(row.mapeo_publicacion_articulo)
                    ? row.mapeo_publicacion_articulo
                    : (row.mapeo_publicacion_articulo ? [row.mapeo_publicacion_articulo] : []);
                const m = maps.find((x: any) => x.articulo_id === input.articulo_id) || maps[0];
                mergeRow(row, 'articulo', m?.cantidad_requerida != null ? Number(m.cantidad_requerida) : null);
            }
        }
    }

    // Consulta B: por seller_sku exacto (case-insensitive)
    if (cleanSku) {
        const escapedSku = cleanSku.replace(/[\\%_]/g, '\\$&');
        const { data } = await sb
            .from('publicaciones_externas')
            .select(baseCols)
            .in('marketplace_id', accounts)
            .in('status_externo', ['active', 'paused', 'under_review'])
            .eq('external_variation_id', '0')
            .ilike('seller_sku', escapedSku)
            .limit(40);
        if (Array.isArray(data)) {
            const targetSkuLower = cleanSku.toLowerCase();
            for (const row of data) {
                if ((row.seller_sku || '').trim().toLowerCase() === targetSkuLower) {
                    mergeRow(row, 'sku', null);
                }
            }
        }
    }

    // Consulta C: por GTIN / EAN (cualquier código en lista separada por coma)
    if (cleanGtins.length > 0) {
        const orExpr = cleanGtins
            .slice(0, 10)
            .flatMap(g => [`gtin.ilike.%${g}%`, `ean.eq.${g}`])
            .join(',');
        const { data } = await sb
            .from('publicaciones_externas')
            .select(baseCols)
            .in('marketplace_id', accounts)
            .in('status_externo', ['active', 'paused', 'under_review'])
            .eq('external_variation_id', '0')
            .or(orExpr)
            .limit(40);
        if (Array.isArray(data)) {
            for (const row of data) {
                const rowTokens = [
                    ...normalizeGtins(row.gtin).list,
                    ...normalizeGtins(row.ean).list,
                ];
                if (cleanGtins.some(g => rowTokens.includes(g))) {
                    mergeRow(row, 'gtin', null);
                }
            }
        }
    }

    const targetLt = (input.listing_type_id || 'gold_special').trim().toLowerCase();
    const reqQty = Math.max(1, Number(input.cantidad_requerida || 1));
    const reqSkuNorm = cleanSku.toLowerCase();

    // Agrupar y clasificar por cuenta
    const byAcct = new Map<string, CandidateRow[]>();
    for (const c of byKey.values()) {
        if (!byAcct.has(c.marketplace_id)) byAcct.set(c.marketplace_id, []);
        byAcct.get(c.marketplace_id)!.push(c);
    }

    for (const acctId of accounts) {
        const rawList = byAcct.get(acctId) || [];
        if (rawList.length === 0) continue;

        // Omitir publicación hija de catálogo si su tradicional padre ya está en los resultados
        const itemIdsInAcct = new Set(rawList.map(r => r.external_item_id));
        const dedupList = rawList.filter(r => {
            const isCat = r.tipo_publicacion === 'catalogo' || r.tipo_publicacion === 'catalogo_derivada';
            if (!isCat) return true;
            const parentPresent = (r.par_item_id && itemIdsInAcct.has(r.par_item_id))
                || (r.id_publicacion_padre && itemIdsInAcct.has(r.id_publicacion_padre));
            return !parentPresent;
        });

        const classified: DuplicateMatchItem[] = dedupList.map(r => {
            const rowLt = (r.listing_type_id || '').trim().toLowerCase();
            const sameLt = !rowLt || rowLt === targetLt;
            const rowQty = r.cantidad_requerida;
            const rowSkuNorm = (r.seller_sku || '').trim().toLowerCase();
            const rowGtins = normalizeGtins(r.gtin || r.ean).list;

            let reason: MatchReason;
            if (r.matched_by.has('articulo')) {
                if (rowQty != null && rowQty !== reqQty) {
                    reason = 'different_pack';
                } else if (!sameLt) {
                    reason = 'different_listing_type';
                } else {
                    reason = 'exact_articulo';
                }
            } else if (r.matched_by.has('sku') && reqSkuNorm && rowSkuNorm && reqSkuNorm === rowSkuNorm) {
                reason = sameLt ? 'exact_sku' : 'different_listing_type';
            } else {
                const singleExactGtinNoSku = !reqSkuNorm && !rowSkuNorm
                    && cleanGtins.length === 1 && rowGtins.length === 1
                    && cleanGtins[0] === rowGtins[0]
                    && sameLt
                    && (rowQty == null || rowQty === reqQty);
                reason = singleExactGtinNoSku ? 'exact_gtin_no_sku' : 'shared_gtin';
            }

            return {
                external_item_id: r.external_item_id,
                titulo: r.titulo,
                status_externo: r.status_externo,
                listing_type_id: r.listing_type_id,
                tipo_publicacion: r.tipo_publicacion,
                seller_sku: r.seller_sku,
                gtin: r.gtin,
                precio_venta: r.precio_venta,
                permalink: r.permalink,
                cantidad_requerida: r.cantidad_requerida,
                match_reason: reason,
            };
        });

        // Ordenar: 🔴 exactos primero, luego 🟡 advertencias; límite 5
        classified.sort((a, b) => Number(isExactReason(b.match_reason)) - Number(isExactReason(a.match_reason)));
        const topMatches = classified.slice(0, 5);
        const hasExact = topMatches.some(m => isExactReason(m.match_reason));
        const level: DuplicateLevel = hasExact ? 'exact' : (topMatches.length > 0 ? 'warning' : 'free');

        result[acctId] = {
            marketplace_id: acctId,
            level,
            matches: topMatches,
            summary: formatSummary(level, topMatches),
        };
    }

    return result;
}
