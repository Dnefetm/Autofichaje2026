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

// ─── Helpers de presentación ───────────────────────────────────────────────
const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-700 border-green-200',
    paused: 'bg-amber-100 text-amber-700 border-amber-200',
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
    drop_off: { label: 'Drop-off', color: 'bg-gray-100 text-gray-600' },
    cross_docking: { label: 'Cross', color: 'bg-teal-100 text-teal-700' },
    self_service: { label: 'Self', color: 'bg-orange-100 text-orange-700' },
};

// Correcto según nomenclatura MeLi México
const listingTypeConfig: Record<string, { label: string; color: string }> = {
    gold_special: { label: 'Clásica',  color: 'bg-gray-100 text-gray-700' },
    gold_pro:     { label: 'Premium',  color: 'bg-amber-100 text-amber-700' },
    free:         { label: 'Gratuita', color: 'bg-green-100 text-green-700' },
};

const tipoPubConfig: Record<string, { label: string; color: string }> = {
    tradicional:        { label: 'Tradicional',  color: 'bg-blue-100 text-blue-700' },
    catalogo:           { label: 'Catálogo',     color: 'bg-purple-100 text-purple-700' },
    catalogo_derivada:  { label: 'Cat. Derivada',color: 'bg-purple-100 text-purple-600 border border-purple-300' },
};

function HealthBar({ value }: { value: number | null }) {
    if (value === null || value === undefined) return <div className="w-16 h-1.5 bg-gray-200 rounded-full" />;
    const pct = Math.round(value * 100);
    const color = pct > 70 ? 'bg-green-500' : pct > 40 ? 'bg-amber-500' : 'bg-red-500';
    return (
        <div className="flex items-center gap-1.5">
            <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-gray-400 tabular-nums">{pct}%</span>
        </div>
    );
}

function StatusBadge({ status }: { status: string }) {
    return (
        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", statusColors[status] || 'bg-slate-100 text-slate-600 border-slate-200')}>
            {statusLabels[status] || status}
        </span>
    );
}

function LogisticBadge({ type }: { type: string | null }) {
    if (!type) return null;
    const cfg = logisticConfig[type];
    return (
        <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold", cfg?.color || 'bg-gray-100 text-gray-600')}>
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

// ─── Agrupación de variantes (por external_item_id) ──────────────────────────
interface GroupedListing {
    parent: any;
    variations: any[];         // variantes de precio/stock (mismo item, distinta variation_id)
    catalogPairs: any[];       // pubs de catálogo asociadas (mismo id_producto_catalogo)
}

function groupByItemId(listings: any[]): GroupedListing[] {
    const map = new Map<string, GroupedListing>();
    for (const l of listings) {
        const key = l.external_item_id;
        if (!map.has(key)) {
            map.set(key, { parent: l, variations: [], catalogPairs: [] });
        }
        const grp = map.get(key)!;
        // Si tiene variation_id real, es variante de producto
        if (l.external_variation_id && l.external_variation_id !== '0') {
            grp.variations.push(l);
        } else {
            grp.parent = l;
        }
    }
    // Segunda pasada: agrupar pubs de catálogo bajo sus pares tradicionales
    // (mismo id_producto_catalogo, diferente external_item_id)
    const result: GroupedListing[] = [];
    const catalogItemIds = new Set<string>();
    const itemById = new Map(Array.from(map.entries()).map(([k, v]) => [k, v]));

    // Identificar items de catálogo que tienen un par tradicional en la misma página
    const traditionalByCatalogId: Map<string, GroupedListing> = new Map();
    for (const [, grp] of itemById) {
        if (
            grp.parent.tipo_publicacion === 'tradicional' &&
            grp.parent.id_producto_catalogo
        ) {
            const catKey = `${grp.parent.marketplace_id}__${grp.parent.id_producto_catalogo}`;
            // Preferir la activa con más ventas como principal
            const existing = traditionalByCatalogId.get(catKey);
            if (
                !existing ||
                (grp.parent.status_externo === 'active' && existing.parent.status_externo !== 'active') ||
                (grp.parent.sold_quantity > (existing.parent.sold_quantity || 0))
            ) {
                traditionalByCatalogId.set(catKey, grp);
            }
        }
    }

    // Adjuntar las variantes de catálogo a su par tradicional
    for (const [, grp] of itemById) {
        if (
            (grp.parent.tipo_publicacion === 'catalogo' || grp.parent.tipo_publicacion === 'catalogo_derivada') &&
            grp.parent.id_producto_catalogo
        ) {
            const catKey = `${grp.parent.marketplace_id}__${grp.parent.id_producto_catalogo}`;
            const trad = traditionalByCatalogId.get(catKey);
            if (trad && trad.parent.external_item_id !== grp.parent.external_item_id) {
                trad.catalogPairs.push(grp.parent);
                catalogItemIds.add(grp.parent.external_item_id);
            }
        }
    }

    // Construir resultado final: primero los grupos que tienen pares, luego el resto
    for (const [itemId, grp] of itemById) {
        if (!catalogItemIds.has(itemId)) {
            result.push(grp);
        }
    }
    return result;
}

// ─── Componente de fila ──────────────────────────────────────────────────────
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
        <tr className={cn("hover:bg-slate-50/70 transition-colors group", indent && "bg-slate-50/50")}>
            {/* 1 — ESTADO */}
            <td className={cn("px-4 py-3 align-top", indent && "pl-10")}>
                <div className="flex flex-col gap-1">
                    <StatusBadge status={listing.status_externo} />
                    {listing.esta_mapeado ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Mapeado
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-rose-500 font-medium">
                            <AlertCircle className="w-3 h-3" /> Sin mapear
                        </span>
                    )}
                    {listing.sync_disabled && (
                        <span className="text-[9px] text-slate-400 italic">sync off</span>
                    )}
                </div>
            </td>

            {/* 2 — PRODUCTO */}
            <td className="px-4 py-3 align-top max-w-xs">
                <div className="flex items-start gap-3">
                    {listing.url_imagen ? (
                        <img src={listing.url_imagen} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" />
                    ) : (
                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                            <Package className="w-4 h-4 text-slate-300" />
                        </div>
                    )}
                    <div className="min-w-0">
                        <Link
                            href={`/catalog/external/${listing.id}`}
                            className="text-sm font-medium text-slate-800 hover:text-indigo-600 line-clamp-2 leading-tight block"
                        >
                            {listing.titulo}
                        </Link>
                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">{listing.external_item_id}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                            {listing.listing_type_id && <ListingTypeBadge type={listing.listing_type_id} />}
                            {listing.tipo_publicacion && <TipoBadge tipo={listing.tipo_publicacion} />}
                            {listing.condition && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium">
                                    {listing.condition === 'new' ? 'Nuevo' : 'Usado'}
                                </span>
                            )}
                            {listing.domain_id && (
                                <span className="text-[10px] text-slate-400 truncate max-w-[100px]" title={listing.domain_id}>
                                    {listing.domain_id.split('-').pop()}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </td>

            {/* 3 — MARCA / SKU */}
            <td className="px-4 py-3 align-top">
                {listing.brand && <p className="text-xs font-semibold text-slate-700">{listing.brand}</p>}
                {/* Mostrar seller_custom_field (SKU variante) con fallback a seller_sku (SKU padre) */}
                {(listing.seller_custom_field || listing.seller_sku) && (
                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">{listing.seller_custom_field || listing.seller_sku}</p>
                )}
                {!listing.brand && !listing.seller_custom_field && !listing.seller_sku && <span className="text-[10px] text-slate-300">—</span>}
            </td>

            {/* 4 — PRECIO / VENTAS */}
            <td className="px-4 py-3 align-top">
                <div className="text-sm font-bold text-slate-900">{formatPrice(listing.precio_venta)}</div>
                {listing.original_price && listing.original_price > listing.precio_venta && (
                    <div className="text-[10px] text-slate-400 line-through">{formatPrice(listing.original_price)}</div>
                )}
                {listing.sold_quantity > 0 && (
                    <div className="text-[10px] text-slate-500 mt-0.5">{listing.sold_quantity} vendidos</div>
                )}
            </td>

            {/* 5 — STOCK / LOGÍST. */}
            <td className="px-4 py-3 align-top">
                <div className="text-sm font-semibold text-slate-800">{listing.stock_publicado ?? '—'}</div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <LogisticBadge type={listing.logistic_type} />
                    {listing.free_shipping && (
                        <span title="Envío gratis">
                            <Truck className="w-3 h-3 text-green-500" />
                        </span>
                    )}
                </div>
            </td>

            {/* 6 — SALUD */}
            <td className="px-4 py-3 align-top">
                <HealthBar value={listing.health} />
            </td>

            {/* 7 — ACCIÓN */}
            <td className="px-4 py-3 align-top text-right">
                <div className="flex items-center justify-end gap-1.5">
                    <Link
                        href={`/catalog/external/${listing.id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg transition-colors border border-indigo-200"
                    >
                        Abrir Ficha
                    </Link>
                    <div className="relative">
                        <button
                            onClick={() => setMenuOpen(o => !o)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                            <MoreVertical className="w-4 h-4" />
                        </button>
                        {menuOpen && (
                            <div
                                className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl border border-slate-200 shadow-lg z-20 py-1"
                                onMouseLeave={() => setMenuOpen(false)}
                            >
                                <button
                                    onClick={() => { onMapear(listing); setMenuOpen(false); }}
                                    className="w-full text-left px-4 py-2 text-xs hover:bg-slate-50 flex items-center gap-2"
                                >
                                    <Link2 className="w-3.5 h-3.5 text-slate-400" />
                                    {listing.esta_mapeado ? 'Editar Mapeo' : 'Crear Enlace (Kit)'}
                                </button>
                                {listing.permalink && (
                                    <a
                                        href={listing.permalink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="w-full text-left px-4 py-2 text-xs hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                                        onClick={() => setMenuOpen(false)}
                                    >
                                        <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
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

// ─── Fila de grupo con variantes + pares de catálogo ───────────────────────────
function GroupedListingRows({ group, onMapear }: { group: GroupedListing; onMapear: (l: any) => void }) {
    const [expanded, setExpanded] = useState(false);
    const [catalogExpanded, setCatalogExpanded] = useState(false);
    const { parent, variations, catalogPairs } = group;

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
            <tr className="hover:bg-slate-50/70 transition-colors group">
                {/* 1 — ESTADO */}
                <td className="px-4 py-3 align-top">
                    <div className="flex flex-col gap-1">
                        <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", statusColors[parent.status_externo] || 'bg-slate-100 text-slate-600 border-slate-200')}>
                            {statusLabels[parent.status_externo] || parent.status_externo}
                        </span>
                        {parent.esta_mapeado ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                                <CheckCircle2 className="w-3 h-3" /> Mapeado
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-rose-500 font-medium">
                                <AlertCircle className="w-3 h-3" /> Sin mapear
                            </span>
                        )}
                    </div>
                </td>

                {/* 2 — PRODUCTO (GroupedListingRows) */}
                <td className="px-4 py-3 align-top max-w-xs">
                    <div className="flex items-start gap-3">
                        {parent.url_imagen ? (
                            <img src={parent.url_imagen} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" />
                        ) : (
                            <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                                <Package className="w-4 h-4 text-slate-300" />
                            </div>
                        )}
                        <div className="min-w-0">
                            <Link href={`/catalog/external/${parent.id}`} className="text-sm font-medium text-slate-800 hover:text-indigo-600 line-clamp-2 leading-tight block">
                                {parent.titulo}
                            </Link>
                            <p className="text-[10px] font-mono text-slate-400 mt-0.5">{parent.external_item_id}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {parent.listing_type_id && <ListingTypeBadge type={parent.listing_type_id} />}
                                {parent.tipo_publicacion && <TipoBadge tipo={parent.tipo_publicacion} />}
                                {variations.length > 0 && (
                                    <button
                                        onClick={() => setExpanded(o => !o)}
                                        className="inline-flex items-center gap-0.5 text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold transition-colors"
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
                                            return summary ? <span className="text-slate-500 font-normal"> ({summary})</span> : null;
                                        })()}
                                    </button>
                                )}
                                {/* Badge de pares de catálogo */}
                                {catalogPairs.length > 0 && (
                                    <button
                                        onClick={() => setCatalogExpanded(o => !o)}
                                        className="inline-flex items-center gap-0.5 text-[10px] text-purple-600 hover:text-purple-800 font-semibold transition-colors"
                                    >
                                        <Layers className="w-3 h-3" />
                                        {catalogPairs.length} catálogo{catalogPairs.length > 1 ? 's' : ''}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </td>

                {/* 3 — MARCA / SKU */}
                <td className="px-4 py-3 align-top">
                    {parent.brand && <p className="text-xs font-semibold text-slate-700">{parent.brand}</p>}
                    {(parent.seller_custom_field || parent.seller_sku) && (
                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">{parent.seller_custom_field || parent.seller_sku}</p>
                    )}
                    {!parent.brand && !parent.seller_custom_field && !parent.seller_sku && <span className="text-[10px] text-slate-300">—</span>}
                </td>

                {/* 4 — PRECIO / VENTAS */}
                <td className="px-4 py-3 align-top">
                    <div className="text-sm font-bold text-slate-900">
                        {priceDisplay || (parent.precio_venta ? `$${Number(parent.precio_venta).toLocaleString('es-MX')}` : '—')}
                    </div>
                    {parent.sold_quantity > 0 && (
                        <div className="text-[10px] text-slate-500 mt-0.5">{parent.sold_quantity} vendidos</div>
                    )}
                </td>

                {/* 5 — STOCK / LOGÍST. */}
                <td className="px-4 py-3 align-top">
                    <div className="text-sm font-semibold text-slate-800">{totalStock ?? '—'}</div>
                    <div className="flex items-center gap-1 mt-1">
                        <LogisticBadge type={parent.logistic_type} />
                        {parent.free_shipping && <Truck className="w-3 h-3 text-green-500" />}
                    </div>
                </td>

                {/* 6 — SALUD */}
                <td className="px-4 py-3 align-top">
                    <HealthBar value={parent.health} />
                </td>

                {/* 7 — ACCIÓN */}
                <td className="px-4 py-3 align-top text-right">
                    <div className="flex items-center justify-end gap-1.5">
                        <Link
                            href={`/catalog/external/${parent.id}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-lg transition-colors border border-indigo-200"
                        >
                            Abrir Ficha
                        </Link>
                        <button
                            onClick={() => onMapear(parent)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-700 hover:bg-indigo-50 transition-colors"
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
                    <tr key={v.id} className="bg-indigo-50/30 border-t border-slate-100">
                        {/* Estado + ID */}
                        <td className="px-4 py-2 pl-12 align-top">
                            <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border', statusColors[v.status_externo] || 'bg-slate-100 text-slate-600 border-slate-200')}>
                                {statusLabels[v.status_externo] || v.status_externo}
                            </span>
                        </td>
                        {/* Atributos */}
                        <td className="px-4 py-2 align-top" colSpan={2}>
                            {attrs.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                    {attrs.map(a => (
                                        <span key={a.name} className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-medium">
                                            {a.name}: <span className="font-bold">{a.value_name}</span>
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <span className="text-[10px] text-slate-400 font-mono">#{v.external_variation_id}</span>
                            )}
                            {v.seller_custom_field && (
                                <p className="text-[10px] font-mono text-slate-400 mt-0.5">{v.seller_custom_field}</p>
                            )}
                        </td>
                        {/* Precio (resaltado si difiere) */}
                        <td className={cn('px-4 py-2 align-top', pricesDiffer && 'bg-amber-50')}>
                            <span className="text-xs font-semibold text-slate-800">
                                {v.precio_venta ? `$${Number(v.precio_venta).toLocaleString('es-MX')}` : '—'}
                            </span>
                        </td>
                        {/* Stock (resaltado si difiere) */}
                        <td className={cn('px-4 py-2 align-top', stocksDiffer && 'bg-amber-50')}>
                            <span className="text-xs text-slate-700">{v.stock_publicado ?? '—'}</span>
                        </td>
                        <td colSpan={2} />
                    </tr>
                );
            })}

            {/* Filas de pares de catálogo (colapsadas por defecto, fondo púrpura) */}
            {catalogExpanded && catalogPairs.map(cp => (
                <tr key={cp.id} className="bg-purple-50/60 border-t border-purple-100">
                    <td className="px-4 py-2 pl-10 align-top">
                        <div className="flex flex-col gap-0.5">
                            <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border', statusColors[cp.status_externo] || 'bg-slate-100 text-slate-600 border-slate-200')}>
                                {statusLabels[cp.status_externo] || cp.status_externo}
                            </span>
                            <TipoBadge tipo={cp.tipo_publicacion} />
                        </div>
                    </td>
                    <td className="px-4 py-2 align-top" colSpan={2}>
                        <div className="flex items-center gap-2">
                            <Layers className="w-3 h-3 text-purple-400 shrink-0" />
                            <div>
                                <p className="text-xs font-medium text-slate-700">{cp.titulo?.slice(0, 60)}{cp.titulo?.length > 60 ? '…' : ''}</p>
                                <p className="text-[10px] font-mono text-slate-400">{cp.external_item_id}</p>
                                {cp.listing_type_id && <ListingTypeBadge type={cp.listing_type_id} />}
                            </div>
                        </div>
                    </td>
                    <td className="px-4 py-2 align-top">
                        <span className="text-xs font-semibold text-slate-800">
                            {cp.precio_venta ? `$${Number(cp.precio_venta).toLocaleString('es-MX')}` : '—'}
                        </span>
                        {cp.sold_quantity > 0 && <p className="text-[10px] text-slate-400">{cp.sold_quantity} vend.</p>}
                    </td>
                    <td className="px-4 py-2 align-top">
                        <span className="text-xs text-slate-700">{cp.stock_publicado ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2 align-top">
                        <HealthBar value={cp.health} />
                    </td>
                    <td className="px-4 py-2 align-top text-right">
                        <Link
                            href={`/catalog/external/${cp.id}`}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 hover:bg-purple-100 text-purple-700 text-[10px] font-semibold rounded-lg border border-purple-200 transition-colors"
                        >
                            Ver ficha →
                        </Link>
                    </td>
                </tr>
            ))}
        </>
    );
}

// ─── Página principal ────────────────────────────────────────────────────────
export default function VirtualCatalogPage() {
    const [listings, setListings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedListing, setSelectedListing] = useState<any | null>(null);
    const [filters, setFilters] = useState<FilterState>(defaultFilters);
    const [showFilters, setShowFilters] = useState(true);

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

            let query = supabase
                .from('publicaciones_externas')
                .select(`*, marketplace:marketplace_configs(account_name)`, { count: 'exact' })
                .order(filters.sortBy, { ascending: filters.sortDir === 'asc' })
                .order('external_item_id', { ascending: true })
                .order('external_variation_id', { ascending: true })
                .range(from, to);

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
            // Búsqueda
            if (debouncedSearch.length >= 2) {
                query = query.or(`titulo.ilike.%${debouncedSearch}%,external_item_id.ilike.%${debouncedSearch}%`);
            }

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
        <div className="flex-1 overflow-auto bg-slate-50 min-h-screen">
            <div className="p-6 pb-32 max-w-[1600px] mx-auto space-y-5">

                {/* Cabecera */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Vitrinas de Mercado Libre</h1>
                        <p className="text-slate-500 text-sm mt-0.5">
                            {totalCount.toLocaleString()} publicaciones · {grouped.length} ítems en esta página
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowFilters(o => !o)}
                            className={cn("flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors", showFilters ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")}
                        >
                            <SlidersHorizontal className="w-4 h-4" />
                            Filtros
                        </button>
                        <button
                            onClick={handleForceSync}
                            disabled={syncing}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium shadow-sm"
                        >
                            <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
                            {syncing ? 'Sincronizando...' : 'Forzar Sync MeLi'}
                        </button>
                        <button onClick={loadListings} className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm shadow-sm">
                            <RefreshCw className="w-4 h-4" />
                            Refrescar
                        </button>
                    </div>
                </div>

                {/* Buscador */}
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar por MLM, título, marca..."
                        className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm"
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
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Estado</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Producto</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Marca / SKU</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Precio / Ventas</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Stock / Logíst.</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Salud</th>
                                            <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Acción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {loading ? (
                                            <tr>
                                                <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                                                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-400" />
                                                    Cargando publicaciones...
                                                </td>
                                            </tr>
                                        ) : grouped.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
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
                                <p className="text-sm text-slate-500">
                                    {page * PAGE_SIZE + 1} – {Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount.toLocaleString()}
                                </p>
                                <div className="flex gap-2">
                                    <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                                        className="px-4 py-2 text-sm font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40">
                                        Anterior
                                    </button>
                                    <button onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= totalCount}
                                        className="px-4 py-2 text-sm font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40">
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
                <div className="fixed bottom-0 left-64 right-0 bg-slate-900 border-t border-slate-700 p-4 max-h-52 overflow-y-auto z-40">
                    <div className="flex justify-between items-center mb-2">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Consola de Sincronización</h4>
                        <button onClick={() => setDebugLogs([])} className="text-xs text-slate-500 hover:text-slate-300">Limpiar</button>
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
