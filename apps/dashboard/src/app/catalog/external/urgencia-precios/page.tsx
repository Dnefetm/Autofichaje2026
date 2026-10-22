"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import {
    ArrowLeft, AlertCircle, CheckCircle2, Clock, RefreshCw,
    Search, ExternalLink, Package, Truck, Filter, ArrowUpDown, ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { Btn } from '@/components/ui/Btn';
import { Card } from '@/components/ui/Card';
import { Page } from '@/components/ui/Page';

interface PricingItem {
    id: string;
    external_item_id: string;
    titulo: string;
    precio_venta: number | null;
    original_price: number | null;
    seller_custom_field: string | null;
    seller_sku: string | null;
    brand: string | null;
    url_imagen: string | null;
    permalink: string | null;
    status_externo: string;
    listing_type_id: string | null;
    logistic_type: string | null;
    sold_quantity: number;
    stock_publicado: number | null;
    health: number | null;
    esta_mapeado: boolean;
    ultima_auditoria_precio_el: string | null;
    ultima_auditoria_precio_accion: string | null;
    publication_pricing_drafts: {
        draft_price: number;
        draft_cost: number;
        pricing_status: string;
    } | null;
}

type TabCategory = 'all' | 'perdida' | 'sobreprecio' | 'sin_precio' | 'alineado';
type SortOption = 'perdida_desc' | 'sobreprecio_desc' | 'pct_desc' | 'audit_urgente' | 'ventas_desc';

const statusColors: Record<string, string> = {
    active: 'bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30',
    paused: 'bg-[var(--warn)]/10 text-[var(--warn)] border-[var(--warn)]/30',
    closed: 'bg-[var(--err)]/10 text-[var(--err)] border-[var(--err)]/30',
    under_review: 'bg-[var(--info)]/10 text-[var(--info)] border-[var(--info)]/30',
};

const statusLabels: Record<string, string> = {
    active: 'Activa',
    paused: 'Pausada',
    closed: 'Cerrada',
    under_review: 'En revisión',
};

function formatCurrency(n: number | null | undefined): string {
    if (n == null) return '—';
    return `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function UrgenciaPreciosPage() {
    const [items, setItems] = useState<PricingItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<TabCategory>('all');
    const [soloSinAuditar, setSoloSinAuditar] = useState(false);
    const [sortBy, setSortBy] = useState<SortOption>('perdida_desc');
    const [auditingId, setAuditingId] = useState<string | null>(null);

    const loadData = async () => {
        setLoading(true);
        try {
            // Traemos únicamente las publicaciones que cuentan con cálculo y lista de costos activa
            const { data, error } = await supabase
                .from('publicaciones_externas')
                .select(`
                    id,
                    external_item_id,
                    titulo,
                    precio_venta,
                    original_price,
                    seller_custom_field,
                    seller_sku,
                    brand,
                    url_imagen,
                    permalink,
                    status_externo,
                    listing_type_id,
                    logistic_type,
                    sold_quantity,
                    stock_publicado,
                    health,
                    esta_mapeado,
                    ultima_auditoria_precio_el,
                    ultima_auditoria_precio_accion,
                    publication_pricing_drafts!inner (
                        draft_price,
                        draft_cost,
                        pricing_status
                    )
                `)
                .gt('publication_pricing_drafts.draft_price', 0)
                .neq('publication_pricing_drafts.pricing_status', 'missing_cost')
                .or('external_variation_id.is.null,external_variation_id.eq.0')
                .order('sold_quantity', { ascending: false })
                .limit(2000);

            if (error) throw error;
            setItems((data as any[]) || []);
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || 'Error al cargar urgencia de precios');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // Quick audit handler
    const handleQuickAudit = async (item: PricingItem) => {
        setAuditingId(item.id);
        try {
            const res = await fetch(`/api/catalog/external/${item.id}/audit-mark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ambito: 'precio', accion: 'revisada_ok' })
            });
            if (!res.ok) throw new Error('Error al registrar auditoría');
            const now = new Date().toISOString();
            setItems(prev => prev.map(p => p.id === item.id ? { ...p, ultima_auditoria_precio_el: now, ultima_auditoria_precio_accion: 'revisada_ok' } : p));
            toast.success(`Precio de ${item.external_item_id} auditado`);
        } catch (e: any) {
            toast.error(e.message || 'Error al auditar precio');
        } finally {
            setAuditingId(null);
        }
    };

    // Procesamiento y métricas
    const processedItems = useMemo(() => {
        return items.map(item => {
            const rawDraft = item.publication_pricing_drafts;
            const draft = Array.isArray(rawDraft) ? rawDraft[0] : rawDraft;
            const draftPrice = draft?.draft_price || 0;
            const draftCost = draft?.draft_cost || 0;
            const precioVenta = Number(item.precio_venta || 0);

            // Brecha financiera (positivo si estamos cobrando MENOS que el sugerido = pérdida)
            const gapDinero = precioVenta - draftPrice;
            const gapPct = draftPrice > 0 ? Math.round((gapDinero / draftPrice) * 100) : 0;

            let categoria: TabCategory = 'alineado';
            if (precioVenta <= 0) {
                categoria = 'sin_precio';
            } else if (gapDinero < 0) {
                categoria = 'perdida';
            } else if (gapDinero > 0) {
                categoria = 'sobreprecio';
            }

            const ageDays = item.ultima_auditoria_precio_el
                ? (Date.now() - new Date(item.ultima_auditoria_precio_el).getTime()) / 86400000
                : Infinity;

            const estadoAuditoria = ageDays === Infinity ? 'sin_auditar' : ageDays > 7 ? 'mas_7_dias' : 'auditado';

            return {
                ...item,
                draftPrice,
                draftCost,
                precioVenta,
                gapDinero,
                gapPct,
                categoria,
                ageDays,
                estadoAuditoria
            };
        });
    }, [items]);

    // Métricas globales para las tarjetas de resumen
    const metrics = useMemo(() => {
        let countPerdida = 0;
        let sumPerdida = 0;
        let countSobreprecio = 0;
        let sumSobreprecio = 0;
        let countSinPrecio = 0;
        let countAlineado = 0;
        let countSinAuditar = 0;

        for (const item of processedItems) {
            if (item.categoria === 'perdida') {
                countPerdida++;
                sumPerdida += Math.abs(item.gapDinero);
            } else if (item.categoria === 'sobreprecio') {
                countSobreprecio++;
                sumSobreprecio += item.gapDinero;
            } else if (item.categoria === 'sin_precio') {
                countSinPrecio++;
            } else if (item.categoria === 'alineado') {
                countAlineado++;
            }

            if (item.estadoAuditoria === 'sin_auditar') {
                countSinAuditar++;
            }
        }

        return {
            total: processedItems.length,
            countPerdida,
            sumPerdida,
            countSobreprecio,
            sumSobreprecio,
            countSinPrecio,
            countAlineado,
            countSinAuditar
        };
    }, [processedItems]);

    // Filtrado y ordenamiento
    const filteredItems = useMemo(() => {
        let list = [...processedItems];

        // Filtro por tab
        if (activeTab !== 'all') {
            list = list.filter(item => item.categoria === activeTab);
        }

        // Filtro solo sin auditar
        if (soloSinAuditar) {
            list = list.filter(item => item.estadoAuditoria === 'sin_auditar');
        }

        // Buscador
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase().trim();
            list = list.filter(item =>
                item.titulo.toLowerCase().includes(term) ||
                item.external_item_id.toLowerCase().includes(term) ||
                (item.seller_custom_field && item.seller_custom_field.toLowerCase().includes(term)) ||
                (item.seller_sku && item.seller_sku.toLowerCase().includes(term)) ||
                (item.brand && item.brand.toLowerCase().includes(term))
            );
        }

        // Ordenamiento
        list.sort((a, b) => {
            if (sortBy === 'perdida_desc') {
                // Mayor pérdida primero (gapDinero más negativo)
                return a.gapDinero - b.gapDinero;
            }
            if (sortBy === 'sobreprecio_desc') {
                // Mayor sobreprecio primero (gapDinero más positivo)
                return b.gapDinero - a.gapDinero;
            }
            if (sortBy === 'pct_desc') {
                return a.gapPct - b.gapPct;
            }
            if (sortBy === 'audit_urgente') {
                // Más días sin auditar primero
                return b.ageDays - a.ageDays;
            }
            if (sortBy === 'ventas_desc') {
                return (b.sold_quantity || 0) - (a.sold_quantity || 0);
            }
            return 0;
        });

        return list;
    }, [processedItems, activeTab, soloSinAuditar, searchTerm, sortBy]);

    return (
        <div className="flex-1 overflow-auto bg-[var(--bg)] min-h-screen">
            <Page>
                {/* Cabecera */}
                <div className="mb-2">
                    <Link
                        href="/catalog/external"
                        className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--accent)] font-medium transition-colors"
                    >
                        <ArrowLeft className="w-3.5 h-3.5" /> Volver a Vitrinas
                    </Link>
                </div>

                <PageHeader
                    title="Urgencia de Precios y Auditoría"
                    description={`${metrics.total.toLocaleString()} publicaciones con lista de precios activa analizadas`}
                    actions={
                        <>
                            <Btn
                                variant="ghost"
                                onClick={loadData}
                                disabled={loading}
                                loading={loading}
                                icon={<RefreshCw className="w-4 h-4" />}
                            >
                                Refrescar
                            </Btn>
                        </>
                    }
                />

                {/* Tarjetas de Resumen KPI */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Tarjeta Pérdida */}
                    <div
                        onClick={() => setActiveTab(activeTab === 'perdida' ? 'all' : 'perdida')}
                        className={cn(
                            "cursor-pointer p-4 rounded-xl border transition-all",
                            activeTab === 'perdida'
                                ? "bg-[var(--err)]/15 border-[var(--err)] shadow-sm"
                                : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--err)]/50"
                        )}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[var(--err)] uppercase tracking-wider">Subprecio / Pérdida</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--err)]/20 text-[var(--err)]">Urgente</span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between">
                            <span className="text-2xl font-black text-[var(--text)]">{metrics.countPerdida}</span>
                            <span className="text-xs font-semibold text-[var(--err)]">-{formatCurrency(metrics.sumPerdida)} MXN</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">
                            Venta en MeLi por debajo del motor
                        </p>
                    </div>

                    {/* Tarjeta Sobreprecio */}
                    <div
                        onClick={() => setActiveTab(activeTab === 'sobreprecio' ? 'all' : 'sobreprecio')}
                        className={cn(
                            "cursor-pointer p-4 rounded-xl border transition-all",
                            activeTab === 'sobreprecio'
                                ? "bg-[var(--warn)]/15 border-[var(--warn)] shadow-sm"
                                : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--warn)]/50"
                        )}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[var(--warn)] uppercase tracking-wider">Sobreprecio</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--warn)]/20 text-[var(--warn)]">Competitividad</span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between">
                            <span className="text-2xl font-black text-[var(--text)]">{metrics.countSobreprecio}</span>
                            <span className="text-xs font-semibold text-[var(--warn)]">+{formatCurrency(metrics.sumSobreprecio)} MXN</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">
                            Precio más alto que la regla óptima
                        </p>
                    </div>

                    {/* Tarjeta Sin Precio */}
                    <div
                        onClick={() => setActiveTab(activeTab === 'sin_precio' ? 'all' : 'sin_precio')}
                        className={cn(
                            "cursor-pointer p-4 rounded-xl border transition-all",
                            activeTab === 'sin_precio'
                                ? "bg-purple-500/15 border-purple-500 shadow-sm"
                                : "bg-[var(--surface)] border-[var(--border)] hover:border-purple-500/50"
                        )}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-purple-600 uppercase tracking-wider">Sin Precio MeLi</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-700">$0</span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between">
                            <span className="text-2xl font-black text-[var(--text)]">{metrics.countSinPrecio}</span>
                            <span className="text-xs text-[var(--text-muted)]">Sin auditar</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">
                            Publicaciones con precio $0 en vitrina
                        </p>
                    </div>

                    {/* Tarjeta Auditoría Pendiente */}
                    <div
                        onClick={() => setSoloSinAuditar(prev => !prev)}
                        className={cn(
                            "cursor-pointer p-4 rounded-xl border transition-all",
                            soloSinAuditar
                                ? "bg-[var(--accent)]/15 border-[var(--accent)] shadow-sm"
                                : "bg-[var(--surface)] border-[var(--border)] hover:border-[var(--accent)]/50"
                        )}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Sin Auditoría</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--surface-2)] text-[var(--text-muted)]">Faltan</span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between">
                            <span className="text-2xl font-black text-[var(--text)]">{metrics.countSinAuditar}</span>
                            <span className="text-xs text-[var(--text-muted)]">
                                {metrics.total > 0 ? `${Math.round((metrics.countSinAuditar / metrics.total) * 100)}%` : '0%'}
                            </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">
                            {soloSinAuditar ? '✓ Filtrando solo sin auditar' : 'Click para filtrar solo sin auditar'}
                        </p>
                    </div>
                </div>

                {/* Filtros y Barra de Búsqueda */}
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between mt-2">
                    {/* Tabs de Categoría */}
                    <div className="flex flex-wrap gap-1 p-1 bg-[var(--surface-2)] rounded-xl border border-[var(--border)]">
                        {[
                            { id: 'all', label: `Todas (${metrics.total})` },
                            { id: 'perdida', label: `🔴 En pérdida (${metrics.countPerdida})` },
                            { id: 'sobreprecio', label: `🟡 Sobreprecio (${metrics.countSobreprecio})` },
                            { id: 'sin_precio', label: `🟣 Sin precio (${metrics.countSinPrecio})` },
                            { id: 'alineado', label: `🟢 Alineadas (${metrics.countAlineado})` },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as TabCategory)}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-semibold rounded-lg transition-all",
                                    activeTab === tab.id
                                        ? "bg-[var(--surface)] text-[var(--text)] shadow-sm border border-[var(--border)]"
                                        : "text-[var(--text-muted)] hover:text-[var(--text)]"
                                )}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Ordenar */}
                    <div className="flex items-center gap-2">
                        <ArrowUpDown className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                        <select
                            value={sortBy}
                            onChange={e => setSortBy(e.target.value as SortOption)}
                            className="text-xs bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--text)] focus:ring-[var(--accent)]"
                        >
                            <option value="perdida_desc">Mayor pérdida ($)</option>
                            <option value="sobreprecio_desc">Mayor sobreprecio ($)</option>
                            <option value="pct_desc">Mayor desviación (%)</option>
                            <option value="audit_urgente">Más urgente de auditar</option>
                            <option value="ventas_desc">Más vendidos</option>
                        </select>
                    </div>
                </div>

                {/* Buscador */}
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                    <input
                        type="text"
                        placeholder="Filtrar por título, MLM, SKU, marca…"
                        className="w-full pl-9 pr-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:ring-2 focus:ring-[var(--accent)]"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Tabla Principal de Urgencia */}
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] border-b border-[var(--border)]">
                                <tr>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Producto</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Estado</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Costo Base</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Precio MeLi</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Sugerido Motor</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Brecha</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-center">Auditoría</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {loading ? (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[var(--accent)]" />
                                            Cargando publicaciones con cálculo de motor...
                                        </td>
                                    </tr>
                                ) : filteredItems.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            No se encontraron publicaciones con estos criterios.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredItems.map(item => {
                                        const sku = item.seller_custom_field || item.seller_sku;
                                        return (
                                            <tr key={item.id} className="hover:bg-[var(--surface-2)]/60 transition-colors">
                                                {/* 1 — PRODUCTO */}
                                                <td className="px-4 py-3 align-top max-w-xs">
                                                    <div className="flex items-start gap-3">
                                                        {item.url_imagen ? (
                                                            <img
                                                                src={item.url_imagen}
                                                                alt=""
                                                                className="w-10 h-10 rounded-lg object-cover border border-[var(--border)] shrink-0"
                                                            />
                                                        ) : (
                                                            <div className="w-10 h-10 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                                                                <Package className="w-4 h-4 text-[var(--text-faint)]" />
                                                            </div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <Link
                                                                href={`/catalog/external/${item.id}`}
                                                                className="text-xs font-semibold text-[var(--text)] hover:text-[var(--accent)] line-clamp-2 leading-tight"
                                                            >
                                                                {item.titulo}
                                                            </Link>
                                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                                <span className="text-[10px] font-mono text-[var(--text-faint)]">{item.external_item_id}</span>
                                                                {sku && (
                                                                    <span className="text-[10px] font-mono bg-[var(--surface-2)] text-[var(--text-muted)] px-1 rounded">
                                                                        {sku}
                                                                    </span>
                                                                )}
                                                                {item.brand && (
                                                                    <span className="text-[10px] text-[var(--text-muted)] font-medium">
                                                                        {item.brand}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* 2 — ESTADO */}
                                                <td className="px-4 py-3 align-top">
                                                    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border", statusColors[item.status_externo] || 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]')}>
                                                        {statusLabels[item.status_externo] || item.status_externo}
                                                    </span>
                                                    {item.sold_quantity > 0 && (
                                                        <div className="text-[10px] text-[var(--text-muted)] mt-1">
                                                            {item.sold_quantity} vendidos
                                                        </div>
                                                    )}
                                                </td>

                                                {/* 3 — COSTO BASE */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    <span className="text-xs font-mono font-medium text-[var(--text-muted)]">
                                                        {formatCurrency(item.draftCost)}
                                                    </span>
                                                </td>

                                                {/* 4 — PRECIO MELI */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    <div className="text-xs font-bold text-[var(--text)]">
                                                        {item.precioVenta > 0 ? formatCurrency(item.precioVenta) : <span className="text-purple-600 font-bold">$0</span>}
                                                    </div>
                                                    {item.original_price && item.original_price > item.precioVenta && (
                                                        <div className="text-[10px] text-[var(--text-faint)] line-through">
                                                            {formatCurrency(item.original_price)}
                                                        </div>
                                                    )}
                                                </td>

                                                {/* 5 — SUGERIDO MOTOR */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    <span className="text-xs font-mono font-bold text-[var(--text)]">
                                                        {formatCurrency(item.draftPrice)}
                                                    </span>
                                                </td>

                                                {/* 6 — BRECHA */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    {item.categoria === 'sin_precio' ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-purple-500/10 text-purple-700 border border-purple-500/30">
                                                            Sin precio ($0)
                                                        </span>
                                                    ) : item.categoria === 'perdida' ? (
                                                        <div className="inline-flex flex-col items-end px-2 py-0.5 rounded bg-[var(--err)]/10 text-[var(--err)] border border-[var(--err)]/30">
                                                            <span className="text-xs font-black">{formatCurrency(item.gapDinero)}</span>
                                                            <span className="text-[10px] font-semibold">{item.gapPct}%</span>
                                                        </div>
                                                    ) : item.categoria === 'sobreprecio' ? (
                                                        <div className="inline-flex flex-col items-end px-2 py-0.5 rounded bg-[var(--warn)]/10 text-[var(--warn)] border border-[var(--warn)]/30">
                                                            <span className="text-xs font-black">+{formatCurrency(item.gapDinero)}</span>
                                                            <span className="text-[10px] font-semibold">+{item.gapPct}%</span>
                                                        </div>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/30">
                                                            Alineado
                                                        </span>
                                                    )}
                                                </td>

                                                {/* 7 — AUDITORÍA */}
                                                <td className="px-4 py-3 align-top text-center">
                                                    {item.estadoAuditoria === 'sin_auditar' ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--err)]/15 text-[var(--err)] border border-[var(--err)]/30">
                                                            <AlertCircle className="w-3 h-3" /> Sin auditar
                                                        </span>
                                                    ) : item.estadoAuditoria === 'mas_7_dias' ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--warn)]/15 text-[var(--warn)] border border-[var(--warn)]/30" title={`Auditado el ${new Date(item.ultima_auditoria_precio_el!).toLocaleDateString('es-MX')}`}>
                                                            <Clock className="w-3 h-3" /> +7d ({Math.floor(item.ageDays)}d)
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--ok)]/15 text-[var(--ok)] border border-[var(--ok)]/30" title={`Auditado el ${new Date(item.ultima_auditoria_precio_el!).toLocaleDateString('es-MX')}`}>
                                                            <CheckCircle2 className="w-3 h-3" /> Auditado
                                                        </span>
                                                    )}
                                                </td>

                                                {/* 8 — ACCIÓN */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            onClick={() => handleQuickAudit(item)}
                                                            disabled={auditingId === item.id}
                                                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg bg-[var(--ok)]/10 hover:bg-[var(--ok)]/20 text-[var(--ok)] border border-[var(--ok)]/30 transition-colors disabled:opacity-50"
                                                            title="Marcar como precio revisado y conforme"
                                                        >
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                            {auditingId === item.id ? '...' : 'Auditar'}
                                                        </button>
                                                        <Link
                                                            href={`/catalog/external/${item.id}`}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 text-[var(--accent)] border border-[var(--accent)]/30 transition-colors"
                                                        >
                                                            Ficha
                                                        </Link>
                                                        {item.permalink && (
                                                            <a
                                                                href={item.permalink}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                className="p-1 rounded-lg text-[var(--text-faint)] hover:text-[var(--text-muted)] hover:bg-[var(--surface-2)] transition-colors"
                                                                title="Ver en Mercado Libre"
                                                            >
                                                                <ExternalLink className="w-3.5 h-3.5" />
                                                            </a>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </Page>
        </div>
    );
}
