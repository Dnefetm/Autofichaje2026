"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
    ArrowLeft, ExternalLink, Link2, Package, Truck, RefreshCw,
    CheckCircle2, AlertCircle, Tag, BarChart2, ShieldCheck, Zap,
    Clock, Globe, DollarSign, Pencil, X, Check, Loader2, ToggleLeft, ToggleRight, Layers
} from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { cn } from '@/lib/utils';
import MappingModal from '@/components/mapping-modal';
import PricingAuditCard from './pricing-audit-card';

// --- Helpers -----------------------------------------------------------------
const statusColors: Record<string, string> = {
    active: 'bg-[var(--ok)]/10 border border-[var(--ok)]/20 text-[var(--ok)] border-transparent',
    paused: 'bg-[var(--warn)]/10 border border-[var(--warn)]/20 text-[var(--warn)] border-transparent',
    closed: 'bg-[var(--err)]/10 border border-[var(--err)]/20 text-[var(--err)] border-transparent',
    under_review: 'bg-[var(--info)]/10 border border-[var(--info)]/20 text-[var(--info)] border-transparent',
};
const statusLabels: Record<string, string> = {
    active: 'Activa',
    paused: 'Pausada',
    closed: 'Cerrada',
    under_review: 'En revisión',
};

const logisticConfig: Record<string, { label: string; color: string }> = {
    fulfillment: { label: 'Mercado Envíos Full', color: 'bg-[var(--info)]/10 border border-[var(--info)]/20 text-[var(--info)]' },
    xd_drop_off: { label: 'XD Drop-off', color: 'bg-[var(--info)]/10 border border-[var(--info)]/20 text-[var(--info)]' },
    drop_off: { label: 'Drop-off', color: 'bg-[var(--surface-2)] text-[var(--text)]' },
    cross_docking: { label: 'Cross-Docking', color: 'bg-[var(--info)]/10 border border-[var(--info)]/20 text-[var(--info)]' },
    self_service: { label: 'Self Service', color: 'bg-orange-100 text-orange-800' },
};

const listingTypeConfig: Record<string, { label: string; color: string }> = {
    gold_special: { label: 'Clásica (~16%)',  color: 'bg-[var(--surface-2)] text-[var(--text)]' },
    gold_pro:     { label: 'Premium (~32%)', color: 'bg-[var(--warn)]/10 border border-[var(--warn)]/20 text-[var(--warn)]' },
    free:         { label: 'Gratuita',        color: 'bg-[var(--ok)]/10 border border-[var(--ok)]/20 text-[var(--ok)]' },
};

const tipoPubConfig: Record<string, { label: string; color: string }> = {
    tradicional:       { label: 'Tradicional',  color: 'bg-[var(--info)]/10 border border-[var(--info)]/20 text-[var(--info)]' },
    catalogo:          { label: 'Catálogo',     color: 'bg-[var(--info)]/10 border border-[var(--info)]/20 text-[var(--info)]' },
    catalogo_derivada: { label: 'Cat. Derivada', color: 'bg-[var(--info)]/10 border border-[var(--info)]/20 text-[var(--info)]' },
};

function HealthBar({ value }: { value: number | null }) {
    if (value === null || value === undefined) return (
        <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-200 rounded-full" />
            <span className="text-xs text-gray-400">Sin datos</span>
        </div>
    );
    const pct = Math.round(value * 100);
    const color = pct > 70 ? 'bg-[var(--ok)]/10 border border-[var(--ok)]/20' : pct > 40 ? 'bg-[var(--warn)]/10 border border-[var(--warn)]/20' : 'bg-[var(--err)]/10 border border-[var(--err)]/20';
    return (
        <div className="flex items-center gap-3">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-sm font-bold text-[var(--text)]">{pct}%</span>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between py-2.5 border-b border-[var(--border)] last:border-0">
            <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 w-36">{label}</span>
            <div className="text-sm text-[var(--text)] text-right flex-1 break-words">{value || <span className="text-[var(--text-faint)]">—</span>}</div>
        </div>
    );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)]  overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2.5 bg-[var(--surface-2)]">
                <div className="text-[var(--text-faint)]">{icon}</div>
                <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">{title}</h2>
            </div>
            <div className="px-5 py-2">{children}</div>
        </div>
    );
}

function DescriptionSection({ text }: { text: string }) {
    const [expanded, setExpanded] = useState(false);
    const preview = text.slice(0, 300);
    const hasMore = text.length > 300;
    return (
        <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)]  overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center gap-2.5 bg-[var(--surface-2)]">
                <div className="text-[var(--text-faint)]"><Tag className="w-4 h-4" /></div>
                <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Descripción</h2>
            </div>
            <div className="px-5 py-4">
                <p className="text-sm text-[var(--text-muted)] leading-relaxed whitespace-pre-line">
                    {expanded ? text : preview}{!expanded && hasMore && '…'}
                </p>
                {hasMore && (
                    <button
                        onClick={() => setExpanded(o => !o)}
                        className="mt-2 text-xs text-[var(--accent)] hover:text-[var(--accent)] font-semibold transition-colors"
                    >
                        {expanded ? 'Ver menos ↑' : 'Ver más ↓'}
                    </button>
                )}
            </div>
        </div>
    );
}

// --- Campo editable inline ----------------------------------------------------
type SaveState = 'idle' | 'saving' | 'ok' | 'error';

function EditableField({
    id,
    field,
    value,
    label,
    type = 'number',
}: {
    id: string;
    field: 'price' | 'stock';
    value: number | null;
    label: string;
    type?: 'number' | 'text';
}) {
    const [editing, setEditing] = useState(false);
    const [inputVal, setInputVal] = useState(String(value ?? ''));
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [localValue, setLocalValue] = useState(value);
    const [errorMsg, setErrorMsg] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const fmt = (n: number | null) => n != null
        ? field === 'price' ? `$${Number(n).toLocaleString('es-MX')}` : `${n} uds.`
        : '—';

    const startEdit = () => { setEditing(true); setInputVal(String(localValue ?? '')); setTimeout(() => inputRef.current?.select(), 50); };
    const cancelEdit = () => { setEditing(false); setSaveState('idle'); };

    const save = async () => {
        const numVal = Number(inputVal);
        if (isNaN(numVal) || numVal < 0) { setErrorMsg('Valor inválido'); return; }
        setSaveState('saving');
        setErrorMsg('');
        try {
            const res = await fetch(`/api/catalog/external/${id}/update`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ field, value: numVal }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error desconocido');
            setLocalValue(numVal);
            setSaveState('ok');
            setTimeout(() => { setEditing(false); setSaveState('idle'); }, 1200);
        } catch (err: any) {
            setSaveState('error');
            setErrorMsg(err.message);
        }
    };

    if (editing) {
        return (
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                    <input
                        ref={inputRef}
                        type={type}
                        value={inputVal}
                        onChange={e => setInputVal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancelEdit(); }}
                        className="w-28 text-sm border-2 border-indigo-400 rounded-[var(--radius)] px-2 py-1 focus:ring-0 outline-none font-semibold"
                        disabled={saveState === 'saving'}
                    />
                    {saveState === 'saving' ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                    ) : saveState === 'ok' ? (
                        <Check className="w-4 h-4 text-green-500" />
                    ) : (
                        <>
                            <button onClick={save} className="p-1.5 bg-[var(--accent)] text-[var(--accent-ink)] rounded-[var(--radius)] hover:bg-[var(--accent)] transition-colors"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={cancelEdit} className="p-1.5 bg-[var(--surface-2)] text-[var(--text-muted)] rounded-[var(--radius)] hover:bg-slate-200 transition-colors"><X className="w-3.5 h-3.5" /></button>
                        </>
                    )}
                </div>
                {saveState === 'error' && (
                    <p className="text-[10px] text-[var(--err)] max-w-48 leading-tight">{errorMsg}</p>
                )}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-2 group">
            <span className="text-sm font-bold text-[var(--text)]">{fmt(localValue)}</span>
            <button
                onClick={startEdit}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)] text-[var(--text-faint)] hover:text-[var(--accent)]"
                title={`Editar ${label}`}
            >
                <Pencil className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}

// --- Toggle de status inline --------------------------------------------------
function StatusToggle({ id, current, disabled }: { id: string; current: string; disabled: boolean }) {
    const [status, setStatus] = useState(current);
    const [saving, setSaving] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const canToggle = status === 'active' || status === 'paused';

    const toggle = async () => {
        if (!canToggle || saving || disabled) return;
        const newStatus = status === 'active' ? 'paused' : 'active';
        setSaving(true);
        setErrorMsg('');
        try {
            const res = await fetch(`/api/catalog/external/${id}/update`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ field: 'status', value: newStatus }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error');
            setStatus(newStatus);
        } catch (err: any) {
            setErrorMsg(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
                <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border', statusColors[status] || 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]')}>
                    {statusLabels[status] || status}
                </span>
                {canToggle && !disabled && (
                    <button
                        onClick={toggle}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[var(--surface-2)] hover:bg-slate-200 text-[var(--text)] text-xs font-semibold rounded-[var(--radius)] transition-colors disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
                            status === 'active'
                                ? <ToggleLeft className="w-3.5 h-3.5 text-amber-500" />
                                : <ToggleRight className="w-3.5 h-3.5 text-green-500" />
                        )}
                        {status === 'active' ? 'Pausar' : 'Activar'}
                    </button>
                )}
            </div>
            {errorMsg && <p className="text-[10px] text-[var(--err)]">{errorMsg}</p>}
        </div>
    );
}

// --- Página ------------------------------------------------------------------
export default function PublicacionDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = React.use(params);

    const [pub, setPub] = useState<any>(null);
    const [mapeos, setMapeos] = useState<any[]>([]);
    const [variantes, setVariantes] = useState<any[]>([]);
    const [asociadas, setAsociadas] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showMappingModal, setShowMappingModal] = useState(false);
    // Fase 3: datos enriquecidos lazy (health actions, costs, visits)
    const [enrichData, setEnrichData] = useState<{ health: any; costs: any; visits: any } | null>(null);
    const [enrichLoading, setEnrichLoading] = useState(false);

    useEffect(() => { loadAll(); }, [id]);

    async function loadAll() {
        setLoading(true);
        try {
            const { data: pubData } = await supabase
                .from('publicaciones_externas')
                .select(`*, marketplace:marketplace_configs(id, account_name), sale_price_calculated, pricing_status, last_calc_at, publication_pricing_drafts(*)`)
                .eq('id', id)
                .single();

            setPub(pubData ? {
                ...pubData,
                deal_ids: pubData.deal_ids ?? [],
                tags: pubData.tags ?? [],
                channels: pubData.channels ?? [],
                sub_status: pubData.sub_status ?? [],
                variation_attributes: pubData.variation_attributes ?? [],
                shipping_tags: pubData.shipping_tags ?? [],
            } : null);

            if (pubData) {
                const { data: mapeosData } = await supabase
                    .from('mapeo_publicacion_articulo')
                    .select(`*, articulo:articulos(articulo_id, nombre, marca, modelo)`)
                    .eq('publicacion_id', id);
                setMapeos(mapeosData || []);

                if (pubData.external_item_id) {
                    const { data: varData } = await supabase
                        .from('publicaciones_externas')
                        .select('id, external_variation_id, precio_venta, stock_publicado, status_externo, variation_attributes, seller_custom_field, seller_sku, variation_picture_ids')
                        .eq('external_item_id', pubData.external_item_id)
                        .neq('id', id);
                    setVariantes(varData || []);
                }

                // Publicaciones asociadas por id_producto_catalogo
                if (pubData.id_producto_catalogo && pubData.marketplace_id) {
                    const { data: asocData } = await supabase
                        .from('publicaciones_externas')
                        .select('id, external_item_id, tipo_publicacion, listing_type_id, status_externo, precio_venta, stock_publicado, sold_quantity, permalink')
                        .eq('id_producto_catalogo', pubData.id_producto_catalogo)
                        .eq('marketplace_id', pubData.marketplace_id)
                        .neq('id', id);
                    setAsociadas(asocData || []);
                }

                // Fase 3: lazy load enriquecimiento desde API de MeLi
                if (pubData.external_item_id && pubData.marketplace_id) {
                    setEnrichLoading(true);
                    fetch(`/api/meli/item-details?itemId=${pubData.external_item_id}&accountId=${pubData.marketplace_id}`)
                        .then(r => r.json())
                        .then(d => setEnrichData(d))
                        .catch(() => {/* silencioso si falla */})
                        .finally(() => setEnrichLoading(false));
                }
            }
        } finally {
            setLoading(false);
        }
    }

    const fmt = (n: number | null) =>
        n != null ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 0 })}` : '—';

    const fmtDate = (d: string | null) =>
        d ? new Date(d).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : null;

    if (loading) return (
        <div className="flex-1 flex items-center justify-center min-h-screen">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
        </div>
    );

    if (!pub) return (
        <div className="flex-1 flex flex-col items-center justify-center min-h-screen gap-4 text-[var(--text-faint)]">
            <AlertCircle className="w-12 h-12" />
            <p className="text-lg font-semibold">Publicación no encontrada</p>
            <Link href="/catalog/external" className="text-[var(--accent)] hover:underline text-sm">← Volver al catálogo</Link>
        </div>
    );

    const logistic = logisticConfig[pub.logistic_type] || null;
    const isVariant = pub.external_variation_id && pub.external_variation_id !== '0';

    return (
        <div className="flex-1 overflow-auto bg-[var(--surface-2)] min-h-screen">
            <div className="p-6 max-w-6xl mx-auto space-y-5">

                {/* Breadcrumb */}
                <Link href="/catalog/external" className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                    Vitrinas de MeLi
                </Link>

                {/* Banner de Kit/Bundle */}
                {(pub.es_bundle || pub.tags?.includes('bundle')) && (
                    <div className="flex items-start gap-3 p-4 bg-orange-50 border border-orange-200 rounded-[var(--radius)]">
                        <Package className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-bold text-orange-800">⚠️ Esta publicación es un Kit (Bundle)</p>
                            <p className="text-xs text-orange-700 mt-0.5">
                                Su stock depende de las publicaciones originales que lo componen. Actualizar el stock directamente puede no reflejar correctamente la disponibilidad real del kit.
                            </p>
                        </div>
                    </div>
                )}

                {/* Header */}
                <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)]  p-6">
                    <div className="flex items-start gap-5">
                        {pub.url_imagen ? (
                            <img src={pub.url_imagen} alt={pub.titulo} className="w-28 h-28 rounded-[var(--radius)] object-contain border border-[var(--border)] bg-[var(--surface)] shrink-0" />
                        ) : (
                            <div className="w-28 h-28 rounded-[var(--radius)] bg-[var(--surface-2)] flex items-center justify-center shrink-0">
                                <Package className="w-10 h-10 text-[var(--text-faint)]" />
                            </div>
                        )}

                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap gap-2 mb-2">
                                <StatusToggle id={id} current={pub.status_externo} disabled={pub.sync_disabled || false} />
                                {/* Tipo de publicación */}
                                {pub.tipo_publicacion && tipoPubConfig[pub.tipo_publicacion] && (
                                    <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold', (tipoPubConfig[pub.tipo_publicacion]?.color ?? ''))}>
                                        {(tipoPubConfig[pub.tipo_publicacion]?.label ?? pub.tipo_publicacion)}
                                    </span>
                                )}
                                {/* Comisión */}
                                {pub.listing_type_id && listingTypeConfig[pub.listing_type_id] && (
                                    <span className={cn('inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold', (listingTypeConfig[pub.listing_type_id]?.color ?? ''))}>
                                        {(listingTypeConfig[pub.listing_type_id]?.label ?? pub.listing_type_id)}
                                    </span>
                                )}
                                {pub.esta_mapeado ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--ok)]/10 border border-[var(--ok)]/20 text-[var(--ok)]">
                                        <CheckCircle2 className="w-3.5 h-3.5" /> Mapeado
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--err)]/10 border border-[var(--err)]/20 text-[var(--err)]">
                                        <AlertCircle className="w-3.5 h-3.5" /> Sin mapear
                                    </span>
                                )}
                                {pub.free_shipping && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--ok)]/10 border border-[var(--ok)]/20 text-[var(--ok)]">
                                        <Truck className="w-3.5 h-3.5" /> Envío gratis
                                    </span>
                                )}
                                {pub.sync_disabled && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--err)]/10 border border-[var(--err)]/20 text-[var(--err)]" title={pub.sync_disabled_reason || ''}>
                                        ⚠ sync off
                                    </span>
                                )}
                            </div>

                            <h1 className="text-xl font-bold text-[var(--text)] leading-snug mb-1">{pub.titulo}</h1>
                            <p className="text-sm font-mono text-[var(--text-faint)]">{pub.external_item_id}{isVariant ? ` · var. ${pub.external_variation_id}` : ''}</p>

                            {/* Atributos de variante (si aplica) */}
                            {isVariant && pub.variation_attributes?.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {(pub.variation_attributes || []).map((a: any) => (
                                        <span key={a.name} className="text-xs bg-[var(--accent)]/10 text-[var(--accent)] border border-indigo-200 px-2 py-0.5 rounded-[var(--radius-sm)] font-medium">
                                            {a.name}: <strong>{a.value_name}</strong>
                                        </span>
                                    ))}
                                </div>
                            )}

                            <div className="flex items-end gap-8 mt-4">
                                {/* Precio — editable */}
                                <div>
                                    <p className="text-xs text-[var(--text-faint)] uppercase font-semibold mb-0.5">Precio</p>
                                    <EditableField id={id} field="price" value={pub.precio_venta} label="Precio" />
                                    {pub.original_price && pub.original_price > pub.precio_venta && (
                                        <p className="text-sm text-[var(--text-faint)] line-through mt-0.5">{fmt(pub.original_price)}</p>
                                    )}
                                </div>
                                {/* Stock — editable */}
                                <div>
                                    <p className="text-xs text-[var(--text-faint)] uppercase font-semibold mb-0.5">Stock</p>
                                    <EditableField id={id} field="stock" value={pub.stock_publicado} label="Stock" />
                                </div>
                                <div className="text-center">
                                    <p className="text-xl font-bold text-[var(--text)]">{pub.sold_quantity ?? 0}</p>
                                    <p className="text-xs text-[var(--text-faint)] uppercase">Vendidos</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-xl font-bold text-[var(--text)]">{pub.health != null ? `${Math.round(pub.health * 100)}%` : '—'}</p>
                                    <p className="text-xs text-[var(--text-faint)] uppercase">Salud</p>
                                </div>
                                {/* Visitas 30d — preferir dato de BD, fallback a lazy API */}
                                <div className="text-center">
                                    {pub.visits_30d != null
                                        ? <p className="text-xl font-bold text-[var(--accent)]">{pub.visits_30d?.toLocaleString()}</p>
                                        : enrichLoading
                                            ? <p className="text-xl font-bold text-[var(--text-faint)] animate-pulse">⋯</p>
                                            : <p className="text-xl font-bold text-[var(--accent)]">
                                                {enrichData?.visits?.total_visits != null
                                                    ? (enrichData?.visits?.total_visits?.toLocaleString() ?? '—')
                                                    : '—'
                                                }
                                              </p>
                                    }
                                    <p className="text-xs text-[var(--text-faint)] uppercase">Visitas 30d</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 shrink-0">
                            {pub.permalink && (
                                <a href={pub.permalink} target="_blank" rel="noreferrer"
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 text-sm font-bold rounded-[var(--radius)] transition-colors">
                                    <ExternalLink className="w-4 h-4" />
                                    Ver en MeLi
                                </a>
                            )}
                            <button
                                onClick={() => setShowMappingModal(true)}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-bold rounded-[var(--radius)] transition-colors"
                            >
                                <Link2 className="w-4 h-4" />
                                {pub.esta_mapeado ? 'Editar Mapeo' : 'Crear Mapeo'}
                            </button>
                            <button onClick={loadAll} className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--surface-2)] hover:bg-slate-200 text-[var(--text)] text-sm font-medium rounded-[var(--radius)] transition-colors">
                                <RefreshCw className="w-4 h-4" />
                                Recargar
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                    {/* Col izquierda — 2/3 */}
                    <div className="lg:col-span-2 space-y-5">

                        {/* SECCIÓN: Estado y Visibilidad */}
                        <Section title="Estado y Visibilidad" icon={<BarChart2 className="w-4 h-4" />}>
                            {/* Barra de salud */}
                            <div className="py-2 border-b border-[var(--border)]">
                                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Salud</p>
                                <HealthBar value={pub.health} />
                                {pub.sync_disabled_reason && (
                                    <p className="text-xs text-[var(--err)] mt-1">⚠️ {pub.sync_disabled_reason}</p>
                                )}
                            </div>
                            {/* Acciones de salud — Fase 3 lazy */}
                            {enrichData?.health?.actions?.length > 0 && (
                                <div className="py-2 border-b border-[var(--border)]">
                                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Acciones recomendadas</p>
                                    <div className="space-y-1.5">
                                        {(enrichData?.health?.actions || []).slice(0, 4).map((action: any, i: number) => {
                                            const isCritical = action.severity === 'critical' || action.impact === 'high';
                                            return (
                                                <div key={i} className={`text-[11px] px-2 py-1.5 rounded-[var(--radius-sm)] flex items-start gap-2 ${isCritical ? 'bg-[var(--err)]/10 border border-[var(--err)]/20 text-[var(--err)] border border-rose-100' : 'bg-[var(--warn)]/10 border border-[var(--warn)]/20 text-[var(--warn)] border border-amber-100'}`}>
                                                    <span className="shrink-0 mt-0.5">{isCritical ? '🔴' : '🟡'}</span>
                                                    <span>{action.reason || action.action_id || action.id}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {/* Sub-status */}
                            {pub.sub_status?.length > 0 && (
                                <div className="py-2 border-b border-[var(--border)]">
                                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Sub-status</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(pub.sub_status || []).map((s: string) => (
                                            <span key={s} className="text-[10px] font-mono bg-[var(--warn)]/10 border border-[var(--warn)]/20 text-[var(--warn)] border border-transparent px-2 py-0.5 rounded-[var(--radius-sm)]">{s}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {/* Tags relevantes (filtrados) */}
                            {(pub.tags || [])?.some((t: string) => [
                                'good_quality_picture', 'good_quality_thumbnail', 'cart_eligible',
                                'dragged_bids', 'dragged_visits', 'poor_quality_picture', 'poor_quality_thumbnail'
                            ].includes(t)) && (
                                <div className="py-2 border-b border-[var(--border)]">
                                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Tags de Visibilidad</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(pub.tags || []).filter((t: string) => [
                                                'good_quality_picture', 'good_quality_thumbnail', 'cart_eligible',
                                                'dragged_bids', 'dragged_visits', 'poor_quality_picture', 'poor_quality_thumbnail'
                                            ].includes(t))
                                            .map((t: string) => {
                                                const good = t.startsWith('good') || t === 'cart_eligible';
                                                return (
                                                    <span key={t} className={`text-[10px] font-mono px-2 py-0.5 rounded-[var(--radius-sm)] ${
                                                        good ? 'bg-[var(--ok)]/10 border border-[var(--ok)]/20 text-[var(--ok)] border border-transparent'
                                                             : 'bg-[var(--err)]/10 border border-[var(--err)]/20 text-[var(--err)] border border-transparent'
                                                    }`}>{t}</span>
                                                );
                                            })
                                        }
                                    </div>
                                </div>
                            )}
                            {/* Canales */}
                            {pub.channels?.length > 0 && (
                                <div className="py-2">
                                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">Canales</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {(pub.channels || []).map((c: string) => (
                                            <span key={c} className="text-[10px] bg-[var(--surface-2)] text-[var(--text-muted)] px-2 py-0.5 rounded-[var(--radius-sm)] font-mono">{c}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </Section>

                        {/* Identificadores */}
                        <Section title="Identificadores" icon={<Tag className="w-4 h-4" />}>
                            <InfoRow label="Item ID" value={<span className="font-mono text-xs">{pub.external_item_id}</span>} />
                            <InfoRow label="Variación ID" value={isVariant ? <span className="font-mono text-xs">{pub.external_variation_id}</span> : null} />
                            <InfoRow
                                label="Tipo"
                                value={pub.tipo_publicacion && tipoPubConfig[pub.tipo_publicacion]
                                    ? <span className={cn('inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] text-xs font-semibold', (tipoPubConfig[pub.tipo_publicacion]?.color ?? ''))}>{(tipoPubConfig[pub.tipo_publicacion]?.label ?? pub.tipo_publicacion)}</span>
                                    : pub.tipo_publicacion
                                }
                            />
                            <InfoRow
                                label="Comisión"
                                value={pub.listing_type_id && listingTypeConfig[pub.listing_type_id]
                                    ? <span className={cn('inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] text-xs font-semibold', (listingTypeConfig[pub.listing_type_id]?.color ?? ''))}>{(listingTypeConfig[pub.listing_type_id]?.label ?? pub.listing_type_id)}</span>
                                    : pub.listing_type_id
                                }
                            />
                            <InfoRow
                                label="ID Producto Cat."
                                value={pub.id_producto_catalogo
                                    ? (
                                        <a
                                            href={`https://www.mercadolibre.com.mx/p/${pub.id_producto_catalogo}`}
                                            target="_blank" rel="noreferrer"
                                            className="font-mono text-xs text-[var(--accent)] hover:underline"
                                        >
                                            {pub.id_producto_catalogo} ↗
                                        </a>
                                    )
                                    : null
                                }
                            />
                            <InfoRow label="Categoría" value={pub.category_id} />
                            <InfoRow label="Dominio" value={pub.domain_id} />
                            <InfoRow label="Marca" value={pub.brand} />
                            <InfoRow label="Modelo" value={pub.model || null} />
                            <InfoRow label="EAN" value={pub.ean || null} />
                            <InfoRow label="GTIN" value={pub.gtin || null} />
                            {/* SKU dual */}
                            <InfoRow
                                label="SKU Ítem"
                                value={pub.seller_sku
                                    ? <span className="font-mono text-xs">{pub.seller_sku}</span>
                                    : <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-[var(--radius-sm)] font-semibold"><AlertCircle className="w-3 h-3" />Sin SKU de ítem</span>
                                }
                            />
                            {(isVariant || (variantes || []).length > 0) && (
                                <InfoRow
                                    label="SKU Variante"
                                    value={
                                        isVariant
                                            ? ((pub.seller_custom_field || pub.seller_sku)
                                                ? <span className="font-mono text-xs text-[var(--accent)] font-bold">{pub.seller_custom_field || pub.seller_sku}</span>
                                                : <span className="inline-flex items-center gap-1 text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-[var(--radius-sm)] font-semibold"><AlertCircle className="w-3 h-3" />Sin SKU de variante</span>)
                                            : <span className="text-[var(--text-faint)] text-xs italic">Ver tabla de variantes ↓</span>
                                    }
                                />
                            )}
                            <InfoRow label="Condición" value={pub.condition === 'new' ? 'Nuevo' : pub.condition === 'used' ? 'Usado' : pub.condition} />
                            <InfoRow label="Garantía" value={pub.warranty} />
                            {pub.upc && <InfoRow label="UPC" value={pub.upc} />}
                            <InfoRow label="Fotos" value={pub.pictures_count != null ? `${pub.pictures_count} imágen${pub.pictures_count !== 1 ? 'es' : ''}` : null} />
                            <InfoRow label="Modo de compra" value={pub.buying_mode} />
                            <InfoRow label="Video" value={pub.video_id ? <span className="text-[var(--ok)] font-semibold text-xs">Sí — {pub.video_id}</span> : <span className="text-[var(--text-faint)] text-xs">No</span>} />
                            {pub.inventory_id && <InfoRow label="Inventory ID" value={<span className="font-mono text-[11px]">{pub.inventory_id}</span>} />}
                            <InfoRow label="Re-publicación auto" value={pub.automatic_relist ? <span className="text-[var(--ok)] font-semibold text-xs">Activa</span> : <span className="text-[var(--text-faint)] text-xs">No</span>} />
                        </Section>

                        {/* Datos Comerciales */}
                        <Section title="Datos Comerciales" icon={<DollarSign className="w-4 h-4" />}>
                            <InfoRow label="Precio actual" value={<span className="font-bold">{fmt(pub.precio_venta)}</span>} />
                            <InfoRow
                                label="Precio original"
                                value={pub.original_price && pub.original_price > pub.precio_venta
                                    ? (
                                        <div className="flex items-center gap-2 justify-end">
                                            <span className="line-through text-[var(--text-faint)] text-sm">{fmt(pub.original_price)}</span>
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-[var(--radius-sm)] bg-[var(--ok)]/10 border border-[var(--ok)]/20 text-[var(--ok)] text-[10px] font-bold">
                                                {Math.round((1 - pub.precio_venta / pub.original_price) * 100)}% OFF
                                            </span>
                                        </div>
                                    )
                                    : pub.original_price ? <span className="line-through text-[var(--text-faint)]">{fmt(pub.original_price)}</span> : null
                                }
                            />
                            <InfoRow label="Moneda" value={pub.currency_id} />
                            <InfoRow
                                label="Comisión"
                                value={
                                    pub.comision_porcentaje != null
                                        ? (
                                            <span className="inline-flex items-center gap-1.5">
                                                <span className="font-semibold text-xs">{Number(pub.comision_porcentaje || 0).toFixed(1)}%</span>
                                                {pub.comision_monto != null && (
                                                    <span className="text-[var(--text-faint)] text-xs">(${pub.comision_monto?.toLocaleString('es-MX', { minimumFractionDigits: 0 })})</span>
                                                )}
                                                <span className="text-[var(--text-faint)] text-[10px]">{pub.listing_type_id && listingTypeConfig[pub.listing_type_id] ? (listingTypeConfig[pub.listing_type_id]?.label ?? pub.listing_type_id) : ''}</span>
                                            </span>
                                        )
                                        : (pub.listing_type_id && listingTypeConfig[pub.listing_type_id] ? (listingTypeConfig[pub.listing_type_id]?.label ?? pub.listing_type_id) : pub.listing_type_id)
                                }
                            />
                            {pub.base_price != null && pub.base_price !== pub.precio_venta && (
                                <InfoRow label="Precio base" value={<span className="font-mono text-xs">{fmt(pub.base_price)}</span>} />
                            )}
                            {pub.comision_monto != null && pub.precio_venta != null && (
                                <InfoRow
                                    label="Ganancia estimada"
                                    value={
                                        <span className="font-semibold text-[var(--ok)] text-xs">
                                            {fmt(pub.precio_venta - pub.comision_monto)}
                                            <span className="text-[var(--text-faint)] font-normal ml-1 text-[10px]">(precio − comisión)</span>
                                        </span>
                                    }
                                />
                            )}
                            <InfoRow label="Ventas totales" value={pub.sold_quantity != null ? `${pub.sold_quantity} unidades` : null} />
                            <InfoRow label="Cantidad inicial" value={pub.initial_quantity != null ? `${pub.initial_quantity} uds.` : null} />
                            <InfoRow
                                label="Deals"
                                value={pub.deal_ids?.length > 0
                                    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--warn)]/10 border border-[var(--warn)]/20 text-[var(--warn)] rounded-[var(--radius-sm)] text-[10px] font-semibold">★ En campaña ({(pub.deal_ids || []).length})</span>
                                    : null
                                }
                            />
                            <InfoRow label="Garantía" value={pub.warranty} />
                        </Section>

                        {/* Logística */}
                        <Section title="Logística" icon={<Truck className="w-4 h-4" />}>
                            <InfoRow label="Tipo" value={logistic ? (
                                <span className={cn('px-2 py-0.5 rounded-[var(--radius-sm)] text-xs font-semibold', logistic.color)}>{logistic.label}</span>
                            ) : pub.logistic_type} />
                            <InfoRow label="Envío gratis" value={pub.free_shipping ? (
                                <span className="text-[var(--ok)] font-semibold flex items-center gap-1 justify-end"><CheckCircle2 className="w-3.5 h-3.5" /> Sí</span>
                            ) : 'No'} />
                            <InfoRow label="Modo envío" value={pub.shipping_mode} />
                            <InfoRow label="Retiro en persona" value={
                                pub.local_pick_up === true  ? <span className="text-[var(--ok)] font-semibold text-xs">Sí</span>
                              : pub.local_pick_up === false ? <span className="text-[var(--text-faint)] text-xs">No</span>
                              : null
                            } />
                            {pub.shipping_tags?.length > 0 && (
                                <InfoRow label="Tags envío" value={
                                    <div className="flex flex-wrap gap-1 justify-end">
                                        {(pub.shipping_tags || []).map((t: string) => (
                                            <span key={t} className="text-[10px] bg-[var(--info)]/10 border border-[var(--info)]/20 text-[var(--info)] border border-blue-100 px-1.5 py-0.5 rounded-[var(--radius-sm)] font-mono">{t}</span>
                                        ))}
                                    </div>
                                } />
                            )}
                            {pub.shipping_dimensions && (
                                <InfoRow label="Dimensiones" value={<span className="font-mono text-[11px]">{JSON.stringify(pub.shipping_dimensions)}</span>} />
                            )}
                        </Section>

                        {/* Descripción del producto */}
                        {pub.description_plain && (
                            <DescriptionSection text={pub.description_plain} />
                        )}

                        {/* Variantes — tabla mejorada */}
                        {(variantes || []).length > 0 && (
                            <Section title={`Variantes (${(variantes || []).length + 1} totales)`} icon={<Package className="w-4 h-4" />}>
                                <div className="-mx-5 overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-[var(--surface-2)]">
                                            <tr>
                                                <th className="px-4 py-2 text-left font-semibold text-[var(--text-muted)] uppercase text-[10px] tracking-wider">Atributos</th>
                                                <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] uppercase text-[10px] tracking-wider">SKU</th>
                                                <th className="px-3 py-2 text-right font-semibold text-[var(--text-muted)] uppercase text-[10px] tracking-wider">Precio</th>
                                                <th className="px-3 py-2 text-right font-semibold text-[var(--text-muted)] uppercase text-[10px] tracking-wider">Stock</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--border)]">
                                            {/* Fila actual (resaltada) */}
                                            <tr className="bg-[var(--accent)]/10">
                                                <td className="px-4 py-2">
                                                    {pub.variation_attributes?.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {(pub.variation_attributes || []).map((a: any) => (
                                                                <span key={a.name} className="text-[10px] bg-[var(--accent)]/10 text-[var(--accent)] px-1.5 py-0.5 rounded-[var(--radius-sm)] font-semibold">
                                                                    {a.name}: {a.value_name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : <span className="text-[var(--text-faint)] font-mono text-[10px]">#{pub.external_variation_id} (actual)</span>}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {(pub.seller_custom_field || pub.seller_sku)
                                                        ? <span className="font-mono text-[10px] text-[var(--text-muted)]">{pub.seller_custom_field || pub.seller_sku}</span>
                                                        : <span className="inline-flex items-center gap-0.5 text-[10px] bg-[var(--err)]/10 border border-[var(--err)]/20 text-[var(--err)] border border-transparent px-1.5 py-0.5 rounded-[var(--radius-sm)]"><AlertCircle className="w-2.5 h-2.5" /> Sin SKU</span>
                                                    }
                                                </td>
                                                <td className="px-3 py-2 text-right font-semibold text-[var(--text)]">{fmt(pub.precio_venta)}</td>
                                                <td className="px-3 py-2 text-right text-[var(--text)]">{pub.stock_publicado ?? '—'}</td>
                                            </tr>
                                            {/* Filas hermanas */}
                                            {(variantes || []).map(v => (
                                                <tr key={v.id} className="hover:bg-[var(--surface-2)] transition-colors">
                                                    <td className="px-4 py-2">
                                                        {v.variation_attributes?.length > 0 ? (
                                                            <div className="flex flex-wrap gap-1">
                                                                {(v.variation_attributes || []).map((a: any) => (
                                                                    <span key={a.name} className="text-[10px] bg-[var(--surface-2)] text-[var(--text)] px-1.5 py-0.5 rounded-[var(--radius-sm)] font-medium">
                                                                        {a.name}: {a.value_name}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : <span className="text-[var(--text-faint)] font-mono text-[10px]">#{v.external_variation_id}</span>}
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {(v.seller_custom_field || v.seller_sku)
                                                            ? <span className="font-mono text-[10px] text-[var(--text-muted)]">{v.seller_custom_field || v.seller_sku}</span>
                                                            : <span className="inline-flex items-center gap-0.5 text-[10px] bg-[var(--err)]/10 border border-[var(--err)]/20 text-[var(--err)] border border-transparent px-1.5 py-0.5 rounded-[var(--radius-sm)]"><AlertCircle className="w-2.5 h-2.5" /> Sin SKU</span>
                                                        }
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-semibold text-[var(--text)]">{fmt(v.precio_venta)}</td>
                                                    <td className="px-3 py-2 text-right text-[var(--text)]">
                                                        <Link href={`/catalog/external/${v.id}`} className="text-[var(--text)] hover:text-[var(--accent)] hover:underline">
                                                            {v.stock_publicado ?? '—'} →
                                                        </Link>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </Section>
                        )}

                        {/* Publicaciones Asociadas */}
                        {(asociadas || []).length > 0 && (
                            <Section title={`Publicaciones Asociadas (${(asociadas || []).length + 1})`} icon={<Layers className="w-4 h-4" />}>
                                <div className="-mx-5 overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead className="bg-[var(--surface-2)]">
                                            <tr>
                                                <th className="px-4 py-2 text-left font-semibold text-[var(--text-muted)] uppercase text-[10px] tracking-wider">Item ID</th>
                                                <th className="px-3 py-2 text-left font-semibold text-[var(--text-muted)] uppercase text-[10px] tracking-wider">Tipo</th>
                                                <th className="px-3 py-2 text-right font-semibold text-[var(--text-muted)] uppercase text-[10px] tracking-wider">Precio</th>
                                                <th className="px-3 py-2 text-right font-semibold text-[var(--text-muted)] uppercase text-[10px] tracking-wider">Stock</th>
                                                <th className="px-3 py-2 text-right font-semibold text-[var(--text-muted)] uppercase text-[10px] tracking-wider"> </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[var(--border)]">
                                            {/* Fila actual */}
                                            <tr className="bg-[var(--accent)]/10">
                                                <td className="px-4 py-2 font-mono text-[10px] font-bold text-[var(--accent)]">{pub.external_item_id}</td>
                                                <td className="px-3 py-2">
                                                    {pub.tipo_publicacion && tipoPubConfig[pub.tipo_publicacion] && (
                                                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] font-semibold', (tipoPubConfig[pub.tipo_publicacion]?.color ?? ''))}>
                                                            {(tipoPubConfig[pub.tipo_publicacion]?.label ?? pub.tipo_publicacion)}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-right font-semibold text-[var(--text)]">{fmt(pub.precio_venta)}</td>
                                                <td className="px-3 py-2 text-right text-[var(--text)]">{pub.stock_publicado ?? '—'}</td>
                                                <td className="px-3 py-2 text-right"><span className="text-[10px] text-[var(--accent)] font-semibold">actual</span></td>
                                            </tr>
                                            {/* Hermanas */}
                                            {(asociadas || []).map(a => {
                                                const tipoCfg = a.tipo_publicacion ? tipoPubConfig[a.tipo_publicacion] : null;
                                                const ltCfg = a.listing_type_id ? listingTypeConfig[a.listing_type_id] : null;
                                                return (
                                                    <tr key={a.id} className="hover:bg-[var(--surface-2)] transition-colors">
                                                        <td className="px-4 py-2">
                                                            <div>
                                                                <p className="font-mono text-[10px] text-[var(--text-muted)]">{a.external_item_id}</p>
                                                                <span className={cn('text-[10px] px-1 py-0.5 rounded-[var(--radius-sm)] font-semibold border', statusColors[a.status_externo] || 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]')}>
                                                                    {statusLabels[a.status_externo] || a.status_externo}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex flex-col gap-0.5">
                                                                {tipoCfg && <span className={cn('text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] font-semibold', tipoCfg.color)}>{tipoCfg.label}</span>}
                                                                {ltCfg && <span className={cn('text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] font-medium', ltCfg.color)}>{ltCfg.label}</span>}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-right font-semibold text-[var(--text)]">{fmt(a.precio_venta)}</td>
                                                        <td className="px-3 py-2 text-right text-[var(--text)]">{a.stock_publicado ?? '—'}</td>
                                                        <td className="px-3 py-2 text-right">
                                                            <Link href={`/catalog/external/${a.id}`} className="text-[10px] text-[var(--info)] hover:text-[var(--info)] font-semibold hover:underline">
                                                                Ver →
                                                            </Link>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </Section>
                        )}

                        {/* Historial */}
                        <Section title="Historial" icon={<Clock className="w-4 h-4" />}>
                            <InfoRow label="Creado en MeLi" value={fmtDate(pub.meli_created_at)} />
                            <InfoRow label="Actualizado en MeLi" value={fmtDate(pub.meli_updated_at)} />
                            <InfoRow label="Sync local" value={fmtDate(pub.actualizado_el)} />
                            <InfoRow label="Marketplace" value={pub.marketplace?.account_name} />
                        </Section>
                    </div>

                    {/* Col derecha */}
                    <div className="space-y-5">

                        {/* Mapeo a bodega */}
                        <Section title="Mapeo a Bodega" icon={<Link2 className="w-4 h-4" />}>
                            {(mapeos || []).length === 0 ? (
                                <div className="py-4 text-center">
                                    <AlertCircle className="w-8 h-8 text-[var(--err)]/70 mx-auto mb-2" />
                                    <p className="text-sm text-[var(--text-muted)]">Sin mapeo</p>
                                    <button
                                        onClick={() => setShowMappingModal(true)}
                                        className="mt-3 px-4 py-2 bg-[var(--accent)] text-[var(--accent-ink)] text-xs font-bold rounded-[var(--radius)] hover:bg-[var(--accent)] transition-colors"
                                    >
                                        Crear Mapeo
                                    </button>
                                </div>
                            ) : (
                                <div className="divide-y divide-[var(--border)]">
                                    {(mapeos || []).map(m => (
                                        <div key={m.id} className="py-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <p className="text-xs font-bold text-[var(--text)]">{m.articulo?.nombre}</p>
                                                    <p className="text-[10px] font-mono text-[var(--text-faint)] mt-0.5">{m.articulo?.articulo_id}</p>
                                                    {m.articulo?.marca && <p className="text-[10px] text-[var(--text-faint)]">{m.articulo.marca}</p>}
                                                </div>
                                                <span className="shrink-0 text-xs font-bold bg-[var(--accent)]/10 text-[var(--accent)] px-2 py-0.5 rounded-[var(--radius-sm)]">
                                                    ×{m.cantidad_requerida}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    <div className="pt-2 pb-1">
                                        <button
                                            onClick={() => setShowMappingModal(true)}
                                            className="w-full text-xs text-[var(--accent)] hover:text-[var(--accent)] font-semibold"
                                        >
                                            Editar mapeo
                                        </button>
                                    </div>
                                </div>
                            )}
                        </Section>

                        {/* Tags técnicos (todos los que no son de visibilidad) */}
                        {pub.tags?.filter((t: string) => ![
                            'good_quality_picture', 'good_quality_thumbnail', 'cart_eligible',
                            'dragged_bids', 'dragged_visits', 'poor_quality_picture', 'poor_quality_thumbnail'
                        ].includes(t)).length > 0 && (
                            <Section title="Tags (todos)" icon={<Globe className="w-4 h-4" />}>
                                <div className="py-2 flex flex-wrap gap-1.5">
                                    {(pub.tags || []).map((t: string) => (
                                        <span key={t} className="text-[10px] font-mono bg-[var(--surface-2)] text-[var(--text-muted)] px-2 py-0.5 rounded-[var(--radius-sm)]">{t}</span>
                                    ))}
                                </div>
                            </Section>
                        )}

                        {/* Auditoría de Precios V2 */}
                        <div className="h-96">
                            <PricingAuditCard 
                                publicacionId={id}
                                salePriceCalculated={pub.sale_price_calculated}
                                currentPrice={pub.precio_venta}
                                draftPrice={pub.publication_pricing_drafts?.[0]?.pricing_review_status === 'pending' ? pub.publication_pricing_drafts[0].draft_price : null}
                                draftStatus={pub.publication_pricing_drafts?.[0]?.pricing_status || null}
                                draftDetails={pub.publication_pricing_drafts?.[0]?.details || null}
                                pricingStatus={pub.pricing_status}
                                lastCalcAt={pub.last_calc_at}
                                onOverrideUpdated={loadAll}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal de Mapeo */}
            {showMappingModal && (
                <MappingModal
                    listing={pub}
                    onClose={() => setShowMappingModal(false)}
                    onSuccess={() => { setShowMappingModal(false); loadAll(); }}
                />
            )}
        </div>
    );
}
