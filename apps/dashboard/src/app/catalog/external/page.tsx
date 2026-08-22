"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Search, RefreshCw, AlertCircle, CheckCircle2, Link2,
    SlidersHorizontal, ExternalLink, MoreVertical, Truck,
    ChevronDown, ChevronRight, Package, Layers
} from 'lucide-react';
import Link from 'next/link';
import MappingModal from '@/components/mapping-modal';
import { FiltersSidebar, FilterState, defaultFilters } from './filters-sidebar';
import { cn } from '@/lib/utils';

// --- Helpers de presentación -----------------------------------------------
// FIX: detectar SKU basura (prefijo UUID de 8 hex chars dejado por migración)
// No se muestra en la UI ni se considera como SKU válido.
function esSkuBasuraUI(sku: string | null | undefined): boolean {
    if (!sku) return true;
    return /^[0-9a-f]{8}$/i.test(sku);
}

const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 border-green-200',
    paused: 'bg-amber-100 text-[var(--warn)] border-[var(--warn)]/30',
    closed: 'bg-red-100 text-red-700 border-red-200',
    under_review: 'bg-blue-100 text-blue-700 border-blue-200',
};

const statusLabels: Record<string, string> = {
    active: 'Activa',
    paused: 'Pausada',
    closed: 'Cerrada',
    under_review: 'En revisión',
};

const logisticConfig: Record<string, { label: string; color: string }> = {
    fulfillment: { label: 'Full', color: 'bg-purple-100 text-purple-700' },
    xd_drop_off: { label: 'XD', color: 'bg-blue-100 text-blue-700' },
    drop_off: { label: 'Drop-off', color: 'bg-[var(--surface-2)] text-[var(--text-muted)]' },
    cross_docking: { label: 'Cross', color: 'bg-teal-100 text-teal-700' },
    self_service: { label: 'Self', color: 'bg-orange-100 text-orange-700' },
};

// Correcto según nomenclatura MeLi México
const listingTypeConfig: Record<string, { label: string; color: string }> = {
    gold_special: { label: 'Clásica',  color: 'bg-[var(--surface-2)] text-[var(--text-muted)]' },
    gold_pro:     { label: 'Premium',  color: 'bg-amber-100 text-[var(--warn)]' },
    free:         { label: 'Gratuita', color: 'bg-green-100 text-green-700' },
};

const tipoPubConfig: Record<string, { label: string; color: string }> = {
    tradicional:        { label: 'Tradicional',  color: 'bg-blue-100 text-blue-700' },
    catalogo:           { label: 'Catálogo',     color: 'bg-purple-100 text-purple-700' },
    catalogo_derivada:  { label: 'Cat. Derivada',color: 'bg-purple-100 text-purple-600 border border-purple-300' },
    up:                 { label: 'User Product', color: 'bg-emerald-100 text-[var(--ok)]' },
};

function HealthBar({ value }: { value: number | null }) {
    if (value === null || value === undefined) return <div className="w-16 h-1.5 bg-gray-200 rounded-full" />;
    const pct = Math.round(value * 100);
    const color = pct > 70 ? 'bg-green-500' : pct > 40 ? 'bg-[var(--warn)]/100' : 'bg-red-500';
    return (
        <div className="flex items-center gap-1.5">
            <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-[var(--text-faint)] tabular-nums">{pct}%</span>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    return (
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", statusColors[status] || 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]')}>
            {statusLabels[status] || status}
        </span>
    );
}

function LogisticBadge({ type }: { type: string | null }) {
    if (!type) return null;
    const cfg = logisticConfig[type];
    return (
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold", cfg?.color || 'bg-[var(--surface-2)] text-[var(--text-muted)]')}>
            {cfg?.label || type}
        </span>
    );
}

function ListingTypeBadge({ type }: { type: string | null }) {
    if (!type) return null;
    const cfg = listingTypeConfig[type];
    if (!cfg) return null;
    return (
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold", cfg.color)}>
            {cfg.label}
        </span>
    );
}

function TipoBadge({ tipo }: { tipo: string | null }) {
    if (!tipo) return null;
    const cfg = tipoPubConfig[tipo];
    if (!cfg) return null;
    return (
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium", cfg.color)}>
            {cfg.label}
        </span>
    );
}

function BundleBadge({ isBundle }: { isBundle: boolean }) {
    if (!isBundle) return null;
    return (
        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700 border border-orange-200">
            <Package className="w-3 h-3" /> Kit
        </span>
    );
}

// --- Agrupación: solo variaciones del mismo external_item_id ---------------------
// Los catálogos con par se excluyen de la query principal (server-side).
// Los hijos de catálogo se cargan lazy cuando el usuario expande la fila.
interface GroupedListing {
    parent: any;
    variations: any[];  // variaciones del mismo external_item_id
}

function groupByItemId(listings: any[]): GroupedListing[] {
    const map = new Map<string, GroupedListing>();
    for (const l of listings) {
        const key = l.external_item_id;
        if (!map.has(key)) {
            map.set(key, { parent: l, variations: [] });
        }
        const grp = map.get(key)!;
        if (l.external_variation_id && l.external_variation_id !== '0') {
            grp.variations.push(l);
        } else {
            grp.parent = l;
        }
    }
    return Array.from(map.values());
}

// --- Componente de fila ------------------------------------------------------
function ListingRow({
    listing,
    onMapear,
    indent = false,
}: {
    listing: any;
    onMapear: (l: any) => void;
    indent?: boolean;
}) {
    const [menuOpen, setMenuOpen] = useState(false);

    const formatPrice = (p: number | null) =>
        p != null ? `$${Number(p).toLocaleString('es-MX', { minimumFractionDigits: 0 })}` : '—';

    return (
        <tr className={cn("hover:bg-[var(--bg)]/70 transition-colors group", indent && "bg-[var(--bg)]/50")}>
            {/* 1 — ESTADO */}
            <td className={cn("px-4 py-3 align-top", indent && "pl-10")}>
                <div className="flex flex-col gap-1">
                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", statusColors[listing.status_externo] || 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]')}>
                        {statusLabels[listing.status_externo] || listing.status_externo}
                    </span>
                    {listing.esta_mapeado ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ok)] font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Mapeado
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--err)] font-medium">
                            <AlertCircle className="w-3 h-3" /> Sin mapear
                        </span>
                    )}
                    {listing.sync_disabled && (
                        <span className="text-[9px] text-[var(--text-faint)] italic">sync off</span>
                    )}
                    <HealthBar value={listing.health} />
                </div>
            </td>

            {/* 2 — PRODUCTO */}
            <td className="px-4 py-3 align-top max-w-xs">
                <div className="flex items-start gap-3">
                    {listing.url_imagen ? (
                        <img src={listing.url_imagen} alt="" className="w-10 h-10 rounded-lg object-cover border border-[var(--border)] shrink-0" />
                    ) : (
                        <div className="w-10 h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                            <Package className="w-4 h-4 text-slate-300" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <Link
                            href={`/catalog/external/${listing.id}`}
                            className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)] line-clamp-2 leading-tight block"
                        >
                            {listing.titulo}
                        </Link>
                        <p className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5">{listing.external_item_id}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                            {listing.listing_type_id && <ListingTypeBadge type={listing.listing_type_id} />}
                            {listing.tipo_publicacion && <TipoBadge tipo={listing.tipo_publicacion} />}
                            <BundleBadge isBundle={listing.es_bundle || listing.tags?.includes('bundle')} />
                            {listing.condition && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-muted)] font-medium">
                                    {listing.condition === 'new' ? 'Nuevo' : 'Usado'}
                                </span>
                            )}
                            {listing.domain_id && (
                                <span className="text-[10px] text-[var(--text-faint)] truncate max-w-[100px]" title={listing.domain_id}>
                                    {listing.domain_id.split('-').pop()}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </td>

            {/* 3 — MARCA / SKU */}
            <td className="px-4 py-3 align-top">
                {listing.brand && <p className="text-xs font-semibold text-[var(--text-muted)]">{listing.brand}</p>}
                {(() => {
                    const sku = !esSkuBasuraUI(listing.seller_custom_field) ? listing.seller_custom_field
                              : !esSkuBasuraUI(listing.seller_sku)          ? listing.seller_sku
                              : null;
                    return sku ? <p className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5">{sku}</p> : null;
                })()}
                {listing.model && (
                    <p className="text-[10px] text-[var(--text-faint)] mt-0.5 italic truncate max-w-[120px]" title={listing.model}>{listing.model}</p>
                )}
                {!listing.brand && esSkuBasuraUI(listing.seller_custom_field) && esSkuBasuraUI(listing.seller_sku) && <span className="text-[10px] text-slate-300">—</span>}
            </td>

            {/* 4 — PRECIO / VENTAS */}
            <td className="px-4 py-3 align-top">
                <div className="text-sm font-bold text-[var(--text)]">{formatPrice(listing.precio_venta)}</div>
                {listing.original_price && listing.original_price > listing.precio_venta && (
                    <div className="text-[10px] text-[var(--text-faint)] line-through">{formatPrice(listing.original_price)}</div>
                )}
                {listing.comision_porcentaje != null && (
                    <div className="text-[10px] text-[var(--text-faint)]">{listing.comision_porcentaje.toFixed(1)}% com.</div>
                )}
                {listing.sold_quantity > 0 && (
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{listing.sold_quantity} vendidos</div>
                )}
                {listing.visits_30d != null && listing.visits_30d > 0 && (
                    <div className="text-[10px] text-[var(--text-faint)]">&#128065; {listing.visits_30d.toLocaleString()} vis.</div>
                )}
            </td>

            {/* 5 — STOCK / LOGÍST. */}
            <td className="px-4 py-3 align-top">
                <div className="text-sm font-semibold text-[var(--text)]">{listing.stock_publicado ?? '—'}</div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <LogisticBadge type={listing.logistic_type} />
                    {listing.free_shipping && (
                        <span title="Envío gratis">
                            <Truck className="w-3 h-3 text-green-500" />
                        </span>
                    )}
                </div>
            </td>

            {/* 6 — ACCIÓN */}
            <td className="px-4 py-3 align-top text-right">
                <div className="flex items-center justify-end gap-1.5">
                    <Link
                        href={`/catalog/external/${listing.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-indigo-700 text-xs font-semibold rounded-lg transition-colors border border-[var(--accent)]/30"
                    >
                        Abrir Ficha
                    </Link>
                    <div className="relative">
                        <button
                            onClick={() => setMenuOpen(o => !o)}
                            className="p-1.5 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-muted)] hover:bg-[var(--surface-2)] transition-colors"
                        >
                            <MoreVertical className="w-4 h-4" />
                        </button>
                        {menuOpen && (
                            <div
                                className="absolute right-0 top-full mt-1 w-48 bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-lg z-20 py-1"
                                onMouseLeave={() => setMenuOpen(false)}
                            >
                                <button
                                    onClick={() => { onMapear(listing); setMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-xs hover:bg-[var(--bg)] flex items-center gap-2"
                                >
                                    <Link2 className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                                    {listing.esta_mapeado ? 'Editar Mapeo' : 'Crear Enlace (Kit)'}
                                </button>
                                {listing.permalink && (
                                    <a
                                        href={listing.permalink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="w-full text-left px-4 py-2 text-xs hover:bg-[var(--bg)] flex items-center gap-2 text-[var(--text-muted)]"
                                        onClick={() => setMenuOpen(false)}
                                    >
                                        <ExternalLink className="w-3.5 h-3.5 text-[var(--text-faint)]" />
                                        Ver en MeLi
                                    </a>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </td>
        </tr>
    );
}

// --- Fila de grupo con variantes ------------------------------------------------
function GroupedListingRows({ group, onMapear }: { group: GroupedListing; onMapear: (l: any) => void }) {
    const [expanded, setExpanded] = useState(false);
    // Lazy-load unificado de catálogos hijos + asociadas en una sola operación
    const [relatedExpanded, setRelatedExpanded] = useState(false);
    const [relatedChildren, setRelatedChildren] = useState<any[] | null>(null);
    const [relatedLoading, setRelatedLoading] = useState(false);
    const { parent, variations } = group;

    const hasCatalogChildren = (parent.catalog_count ?? 0) > 0;
    const catalogCount = parent.catalog_count ?? 0;
    const hasAssociated = (parent.associated_count ?? 0) > 0;
    const assocCount = parent.associated_count ?? 0;

    async function toggleRelated() {
        if (!relatedExpanded && relatedChildren === null) {
            setRelatedLoading(true);
            // Query 1: catálogos derivados directos (por par_item_id)
            const { data: catData } = await supabase
                .from('publicaciones_externas')
                .select('id, external_item_id, titulo, tipo_publicacion, status_externo, listing_type_id, precio_venta, sold_quantity, stock_publicado, health, esta_mapeado, seller_custom_field, seller_sku, brand')
                .eq('par_item_id', parent.external_item_id)
                .in('tipo_publicacion', ['catalogo', 'catalogo_derivada'])
                .eq('external_variation_id', '0')
                .order('status_externo', { ascending: true });
            // Query 2: asociadas por id_producto_catalogo (hermanas tradicionales)
            let assocData: any[] = [];
            if (parent.id_producto_catalogo) {
                const { data } = await supabase
                    .from('publicaciones_externas')
                    .select('id, external_item_id, titulo, tipo_publicacion, status_externo, listing_type_id, precio_venta, sold_quantity, stock_publicado, health, esta_mapeado, seller_custom_field, seller_sku, brand')
                    .eq('id_producto_catalogo', parent.id_producto_catalogo)
                    .neq('external_item_id', parent.external_item_id)
                    .eq('external_variation_id', '0')
                    .order('status_externo', { ascending: true });
                assocData = data || [];
            }
            // Combinar sin duplicados (catálogos primero)
            const catIds = new Set((catData || []).map((c: any) => c.external_item_id));
            const merged = [
                ...(catData || []),
                ...assocData.filter((a: any) => !catIds.has(a.external_item_id)),
            ];
            setRelatedChildren(merged);
            setRelatedLoading(false);
        }
        setRelatedExpanded(o => !o);
    }

    // Compute aggregate values for parent when there are real variations
    const totalStock = variations.length > 0
        ? variations.reduce((s, v) => s + (v.stock_publicado || 0), 0)
        : parent.stock_publicado;
    const prices = variations.length > 0 ? variations.map(v => v.precio_venta).filter(Boolean) : [];
    const priceDisplay = prices.length > 1
        ? `$${Math.min(...prices).toLocaleString('es-MX')} – $${Math.max(...prices).toLocaleString('es-MX')}`
        : null;

    // Patch parent with aggregated stock
    const displayParent = variations.length > 0
        ? { ...parent, stock_publicado: totalStock, precio_venta: prices[0] ?? parent.precio_venta }
        : parent;

    return (
        <>
            <tr className="hover:bg-[var(--bg)]/70 transition-colors group">
                {/* 1 — ESTADO */}
                <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-1">
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", statusColors[parent.status_externo] || 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]')}>
                            {statusLabels[parent.status_externo] || parent.status_externo}
                        </span>
                        {parent.esta_mapeado ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ok)] font-medium">
                                <CheckCircle2 className="w-3 h-3" /> Mapeado
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-[var(--err)] font-medium">
                                <AlertCircle className="w-3 h-3" /> Sin mapear
                            </span>
                        )}
                    </div>
                </td>

                {/* 2 — PRODUCTO (GroupedListingRows) */}
                <td className="px-4 py-3 align-top max-w-xs">
                    <div className="flex items-start gap-3">
                        {parent.url_imagen ? (
                            <img src={parent.url_imagen} alt="" className="w-10 h-10 rounded-lg object-cover border border-[var(--border)] shrink-0" />
                        ) : (
                            <div className="w-10 h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                                <Package className="w-4 h-4 text-slate-300" />
                            </div>
                        )}
                        <div className="min-w-0">
                            <Link href={`/catalog/external/${parent.id}`} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)] line-clamp-2 leading-tight block">
                                {parent.titulo}
                            </Link>
                            <p className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5">{parent.external_item_id}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {parent.listing_type_id && <ListingTypeBadge type={parent.listing_type_id} />}
                                {parent.tipo_publicacion && <TipoBadge tipo={parent.tipo_publicacion} />}
                                {variations.length > 0 && (
                                    <button
                                        onClick={() => setExpanded(o => !o)}
                                        className="inline-flex items-center gap-0.5 text-[10px] text-[var(--accent)] hover:text-indigo-800 font-semibold transition-colors"
                                    >
                                        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                        +{variations.length} variantes
                                        {!expanded && (() => {
                                            const allAttrs = variations.flatMap(v => v.variation_attributes || []);
                                            const byName: Record<string, Set<string>> = {};
                                            for (const a of allAttrs) {
                                                if (!byName[a.name]) byName[a.name] = new Set();
                                                byName[a.name].add(a.value_name);
                                            }
                                            const summary = Object.entries(byName)
                                                .filter(([, vals]) => vals.size > 1)
                                                .map(([name, vals]) => `${name}: ${[...vals].join(', ')}`)
                                                .join(' · ');
                                            return summary ? <span className="text-[var(--text-muted)] font-normal"> ({summary})</span> : null;
                                        })()}
                                    </button>
                                )}
                                {/* Badge unificado catálogos + asociadas */}
                                {(hasCatalogChildren || hasAssociated) && (() => {
                                    const cats   = catalogCount;
                                    const assocs = assocCount;
                                    const label  = cats > 0 && assocs > 0
                                        ? `${cats} catálogo${cats !== 1 ? 's' : ''} y ${assocs} asociada${assocs !== 1 ? 's' : ''}`
                                        : cats > 0
                                            ? `${cats} catálogo${cats !== 1 ? 's' : ''}`
                                            : `${assocs} asociada${assocs !== 1 ? 's' : ''}`;
                                    return (
                                        <button
                                            onClick={toggleRelated}
                                            disabled={relatedLoading}
                                            className="inline-flex items-center gap-0.5 text-[10px] text-[var(--accent)] hover:text-indigo-800 font-semibold transition-colors disabled:opacity-60"
                                        >
                                            <Layers className="w-3 h-3" />
                                            {relatedExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                            {relatedLoading ? 'Cargando…' : label}
                                        </button>
                                    );
                                })()}
                                <BundleBadge isBundle={parent.es_bundle || parent.tags?.includes('bundle')} />
                            </div>
                        </div>
                    </div>
                </td>

                {/* 3 — MARCA / SKU */}
                <td className="px-4 py-3 align-top">
                    {parent.brand && <p className="text-xs font-semibold text-[var(--text-muted)]">{parent.brand}</p>}
                    {(() => {
                        const sku = !esSkuBasuraUI(parent.seller_custom_field) ? parent.seller_custom_field
                                  : !esSkuBasuraUI(parent.seller_sku)          ? parent.seller_sku
                                  : null;
                        return sku ? <p className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5">{sku}</p> : null;
                    })()}
                    {parent.model && (
                        <p className="text-[10px] text-[var(--text-faint)] mt-0.5 italic truncate max-w-[120px]" title={parent.model}>{parent.model}</p>
                    )}
                    {!parent.brand && esSkuBasuraUI(parent.seller_custom_field) && esSkuBasuraUI(parent.seller_sku) && <span className="text-[10px] text-slate-300">—</span>}
                </td>

                {/* 4 — PRECIO / VENTAS */}
                <td className="px-4 py-3 align-top">
                    <div className="text-sm font-bold text-[var(--text)]">
                        {priceDisplay || (parent.precio_venta ? `$${Number(parent.precio_venta).toLocaleString('es-MX')}` : '—')}
                    </div>
                    {parent.comision_porcentaje != null && (
                        <div className="text-[10px] text-[var(--text-faint)]">{parent.comision_porcentaje.toFixed(1)}% com.</div>
                    )}
                    {parent.sold_quantity > 0 && (
                        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{parent.sold_quantity} vendidos</div>
                    )}
                    {parent.visits_30d != null && parent.visits_30d > 0 && (
                        <div className="text-[10px] text-[var(--text-faint)]">&#128065; {parent.visits_30d.toLocaleString()} vis.</div>
                    )}
                </td>

                {/* 5 — STOCK / LOGÍST. */}
                <td className="px-4 py-3 align-top">
                    <div className="text-sm font-semibold text-[var(--text)]">{totalStock ?? '—'}</div>
                    <div className="flex items-center gap-1 mt-1">
                        <LogisticBadge type={parent.logistic_type} />
                        {parent.free_shipping && <Truck className="w-3 h-3 text-green-500" />}
                    </div>
                </td>

                {/* 6 — ACCIÓN */}
                <td className="px-4 py-3 align-top text-right">
                    <div className="flex items-center justify-end gap-1.5">
                        <Link
                            href={`/catalog/external/${parent.id}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-indigo-700 text-xs font-semibold rounded-lg transition-colors border border-[var(--accent)]/30"
                        >
                            Abrir Ficha
                        </Link>
                        <button
                            onClick={() => onMapear(parent)}
                            className="p-1.5 rounded-lg text-[var(--text-faint)] hover:text-indigo-700 hover:bg-[var(--accent)]/10 transition-colors"
                            title={parent.esta_mapeado ? 'Editar Mapeo' : 'Crear Enlace'}
                        >
                            <Link2 className="w-4 h-4" />
                        </button>
                    </div>
                </td>
            </tr>

            {expanded && variations.map(v => {
                const attrs: { name: string; value_name: string }[] = v.variation_attributes || [];
                const pricesDiffer = prices.length > 1 && (Math.max(...prices) - Math.min(...prices)) > 0;
                const stocksDiffer = variations.some(x => x.stock_publicado !== v.stock_publicado);
                return (
                    <tr key={v.id} className="bg-[var(--accent)]/10/30 border-t border-[var(--border)]">
                        {/* Estado + ID */}
                        <td className="px-4 py-2 pl-12 align-top">
                            <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border', statusColors[v.status_externo] || 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]')}>
                                {statusLabels[v.status_externo] || v.status_externo}
                            </span>
                        </td>
                        {/* Atributos */}
                        <td className="px-4 py-2 align-top" colSpan={2}>
                            {attrs.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                    {attrs.map(a => (
                                        <span key={a.name} className="text-[10px] bg-[var(--surface-2)] text-[var(--text-muted)] px-1.5 py-0.5 rounded font-medium">
                                            {a.name}: <span className="font-bold">{a.value_name}</span>
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <span className="text-[10px] text-[var(--text-faint)] font-mono">#{v.external_variation_id}</span>
                            )}
                            {v.seller_custom_field && (
                                <p className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5">{v.seller_custom_field}</p>
                            )}
                        </td>
                        {/* Precio (resaltado si difiere) */}
                        <td className={cn('px-4 py-2 align-top', pricesDiffer && 'bg-[var(--warn)]/10')}>
                            <span className="text-xs font-semibold text-[var(--text)]">
                                {v.precio_venta ? `$${Number(v.precio_venta).toLocaleString('es-MX')}` : '—'}
                            </span>
                        </td>
                        {/* Stock (resaltado si difiere) */}
                        <td className={cn('px-4 py-2 align-top', stocksDiffer && 'bg-[var(--warn)]/10')}>
                            <span className="text-xs text-[var(--text-muted)]">{v.stock_publicado ?? '—'}</span>
                        </td>
                        <td colSpan={1} />
                    </tr>
                );
            })}

            {/* Publicaciones relacionadas unificadas — catálogos (purple) y asociadas (teal) */}
            {relatedExpanded && (relatedChildren || []).map((rel: any) => {
                const isCatalog = rel.tipo_publicacion === 'catalogo' || rel.tipo_publicacion === 'catalogo_derivada';
                return (
                    <tr key={rel.id} className={cn('border-t', isCatalog ? 'bg-purple-50/60 border-purple-100' : 'bg-teal-50/60 border-teal-100')}>
                        <td className="px-4 py-2 pl-10 align-top">
                            <div className="flex flex-col gap-0.5">
                                <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border', statusColors[rel.status_externo] || 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]')}>
                                    {statusLabels[rel.status_externo] || rel.status_externo}
                                </span>
                                <TipoBadge tipo={rel.tipo_publicacion} />
                                {rel.esta_mapeado
                                    ? <span className="text-[9px] text-[var(--ok)] font-medium">Mapeado</span>
                                    : <span className="text-[9px] text-[var(--err)] font-medium">Sin mapear</span>
                                }
                            </div>
                        </td>
                        <td className="px-4 py-2 align-top" colSpan={2}>
                            <div className="flex items-center gap-2">
                                {isCatalog
                                    ? <Layers className="w-3 h-3 text-purple-400 shrink-0" />
                                    : <Link2 className="w-3 h-3 text-teal-400 shrink-0" />
                                }
                                <div>
                                    <Link
                                        href={`/catalog/external/${rel.id}`}
                                        className={cn('text-xs font-medium transition-colors line-clamp-1', isCatalog ? 'text-[var(--text-muted)] hover:text-purple-700' : 'text-[var(--text-muted)] hover:text-teal-700')}
                                    >
                                        {rel.titulo?.slice(0, 55)}{(rel.titulo?.length ?? 0) > 55 ? '…' : ''}
                                    </Link>
                                    <p className="text-[10px] font-mono text-[var(--text-faint)]">{rel.external_item_id}</p>
                                    <div className="flex flex-wrap gap-1 mt-0.5">
                                        {rel.listing_type_id && <ListingTypeBadge type={rel.listing_type_id} />}
                                        <TipoBadge tipo={rel.tipo_publicacion} />
                                    </div>
                                    {(() => {
                                        const relSku = !esSkuBasuraUI(rel.seller_custom_field) ? rel.seller_custom_field
                                                     : !esSkuBasuraUI(rel.seller_sku)           ? rel.seller_sku
                                                     : null;
                                        if (!rel.brand && !relSku) return null;
                                        return (
                                            <p className="text-[10px] text-[var(--text-faint)] mt-0.5">
                                                {rel.brand && <span className="font-semibold">{rel.brand} </span>}
                                                {relSku && <span className="font-mono">{relSku}</span>}
                                            </p>
                                        );
                                    })()}
                                </div>
                            </div>
                        </td>
                        <td className="px-4 py-2 align-top">
                            <span className="text-xs font-semibold text-[var(--text)]">
                                {rel.precio_venta ? `$${Number(rel.precio_venta).toLocaleString('es-MX')}` : '—'}
                            </span>
                            {rel.sold_quantity > 0 && <p className="text-[10px] text-[var(--text-faint)]">{rel.sold_quantity} vend.</p>}
                        </td>
                        <td className="px-4 py-2 align-top">
                            <span className="text-xs text-[var(--text-muted)]">{rel.stock_publicado ?? '—'}</span>
                        </td>
                        <td className="px-4 py-2 align-top text-right">
                            <div className="flex items-center justify-end gap-1.5">
                                <Link
                                    href={`/catalog/external/${rel.id}`}
                                    className={cn('inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-lg border transition-colors', isCatalog ? 'bg-purple-50 hover:bg-purple-100 text-purple-700 border-purple-200' : 'bg-teal-50 hover:bg-teal-100 text-teal-700 border-teal-200')}
                                >
                                    Ver ficha →
                                </Link>
                                <button
                                    onClick={() => onMapear(rel)}
                                    className={cn('p-1.5 rounded-lg text-[var(--text-faint)] transition-colors', isCatalog ? 'hover:text-purple-700 hover:bg-purple-50' : 'hover:text-teal-700 hover:bg-teal-50')}
                                    title="Mapear"
                                >
                                    <Link2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </td>
                    </tr>
                );
            })}

        </>
    );
}


// --- Página principal --------------------------------------------------------
export default function VirtualCatalogPage() {
    const [listings, setListings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedListing, setSelectedListing] = useState<any | null>(null);
    const [filters, setFilters] = useState<FilterState>(defaultFilters);
    const [showFilters, setShowFilters] = useState(false);

    // Paginación
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const PAGE_SIZE = 100;

    // Sync log
    const [syncing, setSyncing] = useState(false);
    const [debugLogs, setDebugLogs] = useState<string[]>([]);

    // Facets
    const [facets, setFacets] = useState<{ brands: any[]; domains: any[] }>({ brands: [], domains: [] });
    const [marketplaces, setMarketplaces] = useState<{ id: string; account_name: string; count?: number }[]>([]);

    const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString();
        setDebugLogs(prev => [...prev.slice(-50), `[${time}] ${msg}`]);
    };

    // Debounce
    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(searchTerm); setPage(0); }, 400);
        return () => clearTimeout(t);
    }, [searchTerm]);

    // Reset page on filter change
    useEffect(() => { setPage(0); }, [filters]);

    useEffect(() => { loadListings(); }, [page, debouncedSearch, filters]);
    useEffect(() => { loadFacets(); loadMarketplaces(); }, []);

    async function loadMarketplaces() {
        const { data } = await supabase
            .from('marketplace_configs')
            .select('id, account_name')
            .eq('is_active', true);
        if (!data || data.length === 0) return;
        // Obtener conteos por marketplace
        const counts = await Promise.all(
            data.map(m => supabase.from('publicaciones_externas')
                .select('id', { count: 'exact', head: true })
                .eq('marketplace_id', m.id))
        );
        setMarketplaces(data.map((m, i) => ({ ...m, count: counts[i].count || 0 })));
    }

    async function loadFacets() {
        const [brandsResult, domainsResult] = await Promise.all([
            supabase.from('publicaciones_externas').select('brand').not('brand', 'is', null),
            supabase.from('publicaciones_externas').select('domain_id').not('domain_id', 'is', null),
        ]);

        // Count manually client-side (Supabase free tier doesn't support GROUP BY in RPC easily)
        const brandCounts = countValues((brandsResult.data || []).map((r: any) => r.brand));
        const domainCounts = countValues((domainsResult.data || []).map((r: any) => r.domain_id));

        setFacets({
            brands: brandCounts.slice(0, 20).map(([v, c]) => ({ value: v, label: v, count: c })),
            domains: domainCounts.slice(0, 20).map(([v, c]) => ({ value: v, label: v.split('-').pop() || v, count: c })),
        });
    }

    function countValues(arr: string[]): [string, number][] {
        const map: Record<string, number> = {};
        for (const v of arr) map[v] = (map[v] || 0) + 1;
        return Object.entries(map).sort((a, b) => b[1] - a[1]);
    }

    async function loadListings() {
        setLoading(true);
        try {
            const from = page * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;

            // --- Búsqueda universal: usa RPC cuando hay término de búsqueda ------------------
            // La RPC busca en TODAS las pubs (incluidos catálogos ocultos) y devuelve
            // resultados con score de relevancia (SKU exacto > prefijo > título).
            if (debouncedSearch.trim().length >= 2) {
                const { data: searchData, error: searchErr } = await supabase.rpc('buscar_publicaciones', {
                    p_term:           debouncedSearch.trim(),
                    p_marketplace_id: filters.marketplace_id || null,
                    p_limit:          PAGE_SIZE,
                    p_offset:         from,
                });
                if (searchErr) throw searchErr;
                const rows = (searchData as any[]) || [];
                setListings(rows);
                setTotalCount(rows[0]?.total_count ? Number(rows[0].total_count) : rows.length);
                return;
            }

            let query = supabase
                .from('publicaciones_externas')
                .select(`*, par_item_id, es_bundle, catalog_count, associated_count, marketplace:marketplace_configs(account_name)`, { count: 'exact' })
                .order(filters.sortBy, { ascending: filters.sortDir === 'asc' })
                .order('external_item_id', { ascending: true })
                .order('external_variation_id', { ascending: true })
                .range(from, to);

            // --- Exclusión server-side de catálogos con par --------------------------
            // Excluir publicaciones de catálogo que son hijas de una tradicional (tienen par_item_id).
            // Condición: par_item_id IS NULL  →  incluir (huérfanos de catálogo + todas las tradicionales)
            // Solo aplica cuando el usuario NO filtra explícitamente por tipo catálogo.
            if (filters.tipoPublicacion.length === 0 || !filters.tipoPublicacion.some(t => t.startsWith('catalogo'))) {
                // Muestra filas que sean: tradicionales, up (User Products), null, catálogos sin par (huérfanos)
                query = query.or(
                    'tipo_publicacion.eq.tradicional,' +
                    'tipo_publicacion.eq.up,' +
                    'tipo_publicacion.is.null,' +
                    'and(tipo_publicacion.eq.catalogo,par_item_id.is.null),' +
                    'and(tipo_publicacion.eq.catalogo_derivada,par_item_id.is.null)'
                );
            }

            // Marketplace (vidriera)
            if (filters.marketplace_id) query = query.eq('marketplace_id', filters.marketplace_id);
            // Tipo de publicación
            if (filters.tipoPublicacion.length > 0) query = query.in('tipo_publicacion', filters.tipoPublicacion);
            // Estado
            if (filters.statusExterno.length > 0 && filters.statusExterno.length < 4) {
                query = query.in('status_externo', filters.statusExterno);
            }
            // Mapeo
            if (filters.mapeoFilter === 'unmapped') query = query.eq('esta_mapeado', false);
            else if (filters.mapeoFilter === 'mapped') query = query.eq('esta_mapeado', true);
            // Bundles
            if (filters.bundleFilter === 'only_bundles') query = query.contains('tags', ['bundle']);
            else if (filters.bundleFilter === 'hide_bundles') query = query.not('tags', 'cs', '{"bundle"}');
            // Marca
            if (filters.brands.length > 0) query = query.in('brand', filters.brands);
            // Dominio
            if (filters.domainIds.length > 0) query = query.in('domain_id', filters.domainIds);
            // Listing type
            if (filters.listingTypes.length > 0) query = query.in('listing_type_id', filters.listingTypes);
            // Logística
            if (filters.logisticTypes.length > 0) query = query.in('logistic_type', filters.logisticTypes);
            // Envío gratis
            if (filters.freeShipping !== null) query = query.eq('free_shipping', filters.freeShipping);
            // Condición
            if (filters.condition) query = query.eq('condition', filters.condition);
            // Precio
            if (filters.priceMin !== null) query = query.gte('precio_venta', filters.priceMin);
            if (filters.priceMax !== null) query = query.lte('precio_venta', filters.priceMax);
            // Health
            if (filters.healthRange === 'high') query = query.gte('health', 0.7);
            else if (filters.healthRange === 'medium') query = query.gte('health', 0.4).lt('health', 0.7);
            else if (filters.healthRange === 'low') query = query.lt('health', 0.4);
            else if (filters.healthRange === 'none') query = query.is('health', null);
            // Ventas
            if (filters.salesRange === '0') query = query.eq('sold_quantity', 0);
            else if (filters.salesRange === '1-10') query = query.gte('sold_quantity', 1).lte('sold_quantity', 10);
            else if (filters.salesRange === '11-50') query = query.gte('sold_quantity', 11).lte('sold_quantity', 50);
            else if (filters.salesRange === '50+') query = query.gte('sold_quantity', 51);
            // Stock
            if (filters.stockRange === '0') query = query.eq('stock_publicado', 0);
            else if (filters.stockRange === '1-5') query = query.gte('stock_publicado', 1).lte('stock_publicado', 5);
            else if (filters.stockRange === '6-20') query = query.gte('stock_publicado', 6).lte('stock_publicado', 20);
            else if (filters.stockRange === '20+') query = query.gte('stock_publicado', 21);

            const { data, error, count } = await query;
            if (error) throw error;
            setListings(data || []);
            setTotalCount(count || 0);
        } catch (error) {
            console.error('Error fetching listings:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleForceSync() {
        setSyncing(true);
        setDebugLogs([]);
        addLog('Iniciando sincronización Serverless...');
        try {
            const { data: configs, error: configsErr } = await supabase
                .from('marketplace_configs').select('id, account_name').eq('is_active', true);
            if (configsErr) throw configsErr;
            if (!configs || configs.length === 0) { addLog('ERROR: No hay tiendas activas.'); return; }

            let totalGeneral = 0;
            for (const config of configs) {
                addLog(`Tienda: ${config.account_name}`);
                let hasMore = true;
                let currentScrollId: string | null = null;
                let cachedUserId: string | null = null;
                let relayCount = 0;
                while (hasMore) {
                    relayCount++;
                    addLog(`Relay #${relayCount} → ${config.account_name}`);
                    const res = await fetch('/api/sync/manual', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ accountId: config.id, scrollId: currentScrollId, userId: cachedUserId })
                    });
                    const text = await res.text();
                    let result;
                    try { result = JSON.parse(text); } catch { throw new Error(`Vercel 500: ${text.substring(0, 200)}`); }
                    if (!res.ok) throw new Error(`Error: ${result.error || result.message}`);
                    if (result.userId) cachedUserId = result.userId;
                    if (result.diagnosticLogs) result.diagnosticLogs.forEach((dl: string) => addLog(`🔍 ${dl}`));
                    const delta = result.totalProcessed || result.processedSoFar || 0;
                    if (delta > 0) { totalGeneral += delta; addLog(`+${delta} ítems. Total: ${totalGeneral}`); }
                    if (result.hasMore) {
                        hasMore = true;
                        currentScrollId = result.scrollId || null;
                        await new Promise(r => setTimeout(r, 100));
                    } else {
                        addLog(`✓ ${config.account_name} completa.`);
                        hasMore = false;
                    }
                }

                // -- Enriquecimiento post-sync (comisiones + visitas + descripciones) --
                addLog(`⚡ Enriqueciendo datos de ${config.account_name}...`);
                try {
                    let enrichHasMore = true;
                    let enrichOffset  = 0;
                    let enrichRelay   = 0;
                    while (enrichHasMore) {
                        enrichRelay++;
                        const enrichRes = await fetch('/api/sync/enrich', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ accountId: config.id, offset: enrichOffset })
                        });
                        const enrichResult = await enrichRes.json();
                        enrichHasMore = enrichResult.hasMore ?? false;
                        enrichOffset  = enrichResult.offset ?? enrichOffset;
                        addLog(`  Enrich relay #${enrichRelay}: ${enrichResult.processed ?? 0}/${enrichResult.total ?? '?'} items`);
                        if (enrichHasMore) await new Promise(r => setTimeout(r, 150));
                    }
                    addLog(`✓ Enriquecimiento de ${config.account_name} completado.`);
                } catch (enrichErr: any) {
                    addLog(`⚠ Enrich falló (no crítico): ${enrichErr.message}`);
                }
            }
            addLog(`¡Éxito! ${totalGeneral} ítems guardados.`);
            setTimeout(() => setDebugLogs([]), 8000);
            loadListings();
        } catch (error: any) {
            addLog(`❌ ABORTO: ${error.message}`);
        } finally {
            setSyncing(false);
        }
    }

    const grouped = useMemo(() => groupByItemId(listings), [listings]);

    return (
        <div className="flex-1 overflow-auto bg-[var(--bg)] min-h-screen">
            <div className="p-6 pb-32 max-w-[1600px] mx-auto space-y-5">

                {/* Cabecera */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">Vitrinas de Mercado Libre</h1>
                        <p className="text-[var(--text-muted)] text-sm mt-0.5">
                            {totalCount.toLocaleString()} publicaciones · {grouped.length} ítems en esta página
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowFilters(o => !o)}
                            className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors", showFilters ? "bg-[var(--accent)] text-[var(--accent-ink)] border-indigo-600" : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--bg)]")}
                        >
                            <SlidersHorizontal className="w-4 h-4" />
                            Filtros
                        </button>
                        <button
                            onClick={handleForceSync}
                            disabled={syncing}
                            className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg hover:brightness-110 disabled:opacity-50 text-sm font-medium shadow-sm"
                        >
                            <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
                            {syncing ? 'Sincronizando...' : 'Forzar Sync MeLi'}
                        </button>
                        <button onClick={loadListings} className="flex items-center gap-2 px-3 py-2 bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--bg)] text-sm shadow-sm">
                            <RefreshCw className="w-4 h-4" />
                            Refrescar
                        </button>
                    </div>
                </div>

                {/* Buscador */}
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                    <input
                        type="text"
                        placeholder="Buscar por título, MLM, SKU, marca…"
                        className="w-full pl-9 pr-4 py-2.5 bg-[var(--surface)] border border-[var(--border)] rounded-xl focus:ring-2 focus:ring-[var(--accent)] text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] shadow-sm"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Layout: Sidebar + Tabla */}
                <div className="flex gap-5 items-start">
                    {showFilters && (
                        <FiltersSidebar filters={filters} onChange={setFilters} facets={facets} marketplaces={marketplaces} />
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="bg-[var(--surface)] rounded-xl shadow-sm border border-[var(--border)] overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Estado</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Producto</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Marca / SKU</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Precio / Ventas</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Stock / Logíst.</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-[var(--border)]">
                                        {loading ? (
                                            <tr>
                                                <td colSpan={7} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                                                    Cargando publicaciones...
                                                </td>
                                            </tr>
                                        ) : grouped.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                                    No se encontraron publicaciones con estos filtros.
                                                </td>
                                            </tr>
                                        ) : (
                                            grouped.map(group => (
                                                <GroupedListingRows
                                                    key={group.parent.id}
                                                    group={group}
                                                    onMapear={setSelectedListing}
                                                />
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Paginación */}
                        {!loading && totalCount > PAGE_SIZE && (
                            <div className="flex items-center justify-between mt-4">
                                <p className="text-sm text-[var(--text-muted)]">
                                    {page * PAGE_SIZE + 1} – {Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount.toLocaleString()}
                                </p>
                                <div className="flex gap-2">
                                    <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                                        className="px-4 py-2 text-sm font-medium bg-[var(--surface)] border border-slate-300 rounded-lg hover:bg-[var(--bg)] disabled:opacity-40">
                                        Anterior
                                    </button>
                                    <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= totalCount}
                                        className="px-4 py-2 text-sm font-medium bg-[var(--surface)] border border-slate-300 rounded-lg hover:bg-[var(--bg)] disabled:opacity-40">
                                        Siguiente
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Consola de Sync */}
            {debugLogs.length > 0 && (
                <div className="fixed bottom-0 left-64 right-0 bg-[var(--surface-2)] border-t border-slate-700 p-4 max-h-52 overflow-y-auto z-40">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-xs font-bold text-[var(--text-faint)] uppercase tracking-wider">Consola de Sincronización</h4>
                        <button onClick={() => setDebugLogs([])} className="text-xs text-[var(--text-muted)] hover:text-slate-300">Limpiar</button>
                    </div>
                    <div className="font-mono text-xs space-y-0.5">
                        {debugLogs.map((log, i) => (
                            <div key={i} className={log.includes('❌') || log.includes('ERROR') ? 'text-red-400' : log.includes('✓') || log.includes('Éxito') ? 'text-green-400' : 'text-slate-300'}>
                                {log}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Modal de Mapeo */}
            {selectedListing && (
                <MappingModal
                    listing={selectedListing}
                    onClose={() => setSelectedListing(null)}
                    onSuccess={() => { setSelectedListing(null); loadListings(); }}
                />
            )}
        </div>
    );
}
