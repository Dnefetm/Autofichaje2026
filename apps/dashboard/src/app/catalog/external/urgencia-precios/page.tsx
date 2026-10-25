"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import {
    ArrowLeft, AlertCircle, CheckCircle2, Clock, RefreshCw,
    Search, ExternalLink, Package, ArrowUpDown, ChevronLeft, ChevronRight, Sliders
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { Btn } from '@/components/ui/Btn';
import { Card } from '@/components/ui/Card';
import { Page } from '@/components/ui/Page';

interface UrgenciaItem {
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
    draft_price: number;
    draft_cost: number;
    pricing_status: string;
    precio_equilibrio: number;
    gap_dinero: number;
    gap_pct: number;
    categoria: TabCategory;
    estado_auditoria: 'sin_auditar' | 'mas_7_dias' | 'auditado';
}

interface UrgenciaKpis {
    total: number;
    count_perdida: number;
    sum_perdida: number;
    count_sobreprecio: number;
    sum_sobreprecio: number;
    count_sin_precio: number;
    count_alineado: number;
    count_sin_auditar: number;
}

type TabCategory = 'all' | 'perdida' | 'sobreprecio' | 'sin_precio' | 'alineado';
type SortOption = 'perdida_desc' | 'sobreprecio_desc' | 'pct_desc' | 'audit_urgente' | 'ventas_desc';

const PAGE_SIZE = 50;

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

function UrgenciaPreciosInner() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();

    // 1. Inicializar filtros desde la URL
    const urlTab = (searchParams.get('tab') as TabCategory) || 'all';
    const urlSearch = searchParams.get('search') || '';
    const urlSort = (searchParams.get('sort') as SortOption) || 'perdida_desc';
    const urlSoloSinAuditar = searchParams.get('unreviewed') === '1';
    const urlPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

    const [activeTab, setActiveTab] = useState<TabCategory>(urlTab);
    const [searchTerm, setSearchTerm] = useState<string>(urlSearch);
    const [debouncedSearch, setDebouncedSearch] = useState<string>(urlSearch);
    const [sortBy, setSortBy] = useState<SortOption>(urlSort);
    const [soloSinAuditar, setSoloSinAuditar] = useState<boolean>(urlSoloSinAuditar);
    const [page, setPage] = useState<number>(urlPage);

    // 2. Datos
    const [kpis, setKpis] = useState<UrgenciaKpis>({
        total: 0,
        count_perdida: 0,
        sum_perdida: 0,
        count_sobreprecio: 0,
        sum_sobreprecio: 0,
        count_sin_precio: 0,
        count_alineado: 0,
        count_sin_auditar: 0,
    });
    const [items, setItems] = useState<UrgenciaItem[]>([]);
    const [totalCount, setTotalCount] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(true);
    const [auditingId, setAuditingId] = useState<string | null>(null);

    // URL completa para el parámetro `?from=`
    const currentUrl = useMemo(() => {
        const params = new URLSearchParams();
        if (activeTab !== 'all') params.set('tab', activeTab);
        if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
        if (sortBy !== 'perdida_desc') params.set('sort', sortBy);
        if (soloSinAuditar) params.set('unreviewed', '1');
        if (page > 1) params.set('page', String(page));
        const qs = params.toString();
        return qs ? `${pathname}?${qs}` : pathname;
    }, [pathname, activeTab, debouncedSearch, sortBy, soloSinAuditar, page]);

    // Sincronizar URL cuando cambian los filtros
    useEffect(() => {
        router.replace(currentUrl, { scroll: false });
    }, [currentUrl, router]);

    // Debounce del buscador
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            setPage(1);
        }, 350);
        return () => clearTimeout(handler);
    }, [searchTerm]);

    // 3. Cargar KPIs (1 llamada rápida al servidor)
    const loadKpis = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('fn_urgencia_precios_kpis');
            if (error) throw error;
            if (data) setKpis(data as UrgenciaKpis);
        } catch (e: any) {
            console.error('Error cargando KPIs de urgencia:', e);
        }
    }, []);

    // 4. Cargar página de datos (servidor: filtra, ordena y pagina 50 filas)
    const loadPageData = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('v_urgencia_precios')
                .select('*', { count: 'exact' });

            // Filtro por tab
            if (activeTab !== 'all') {
                query = query.eq('categoria', activeTab);
            }

            // Filtro solo sin auditar
            if (soloSinAuditar) {
                query = query.eq('estado_auditoria', 'sin_auditar');
            }

            // Buscador
            if (debouncedSearch.trim()) {
                const t = debouncedSearch.trim();
                query = query.or(`titulo.ilike.%${t}%,external_item_id.ilike.%${t}%,seller_custom_field.ilike.%${t}%,seller_sku.ilike.%${t}%,brand.ilike.%${t}%`);
            }

            // Ordenamiento en servidor
            if (sortBy === 'perdida_desc') {
                query = query.order('gap_dinero', { ascending: true }); // Más negativo = mayor pérdida
            } else if (sortBy === 'sobreprecio_desc') {
                query = query.order('gap_dinero', { ascending: false }); // Más positivo = mayor sobreprecio
            } else if (sortBy === 'pct_desc') {
                query = query.order('gap_pct', { ascending: true });
            } else if (sortBy === 'audit_urgente') {
                query = query.order('ultima_auditoria_precio_el', { ascending: true, nullsFirst: true });
            } else if (sortBy === 'ventas_desc') {
                query = query.order('sold_quantity', { ascending: false });
            }

            // Paginación server-side (50 filas)
            const from = (page - 1) * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;
            query = query.range(from, to);

            const { data, count, error } = await query;
            if (error) throw error;

            setItems((data as UrgenciaItem[]) || []);
            setTotalCount(count || 0);
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || 'Error al cargar urgencia de precios');
        } finally {
            setLoading(false);
        }
    }, [activeTab, soloSinAuditar, debouncedSearch, sortBy, page]);

    useEffect(() => {
        loadKpis();
    }, [loadKpis]);

    useEffect(() => {
        loadPageData();
    }, [loadPageData]);

    // Quick audit handler
    const handleQuickAudit = async (item: UrgenciaItem) => {
        setAuditingId(item.id);
        try {
            const res = await fetch(`/api/catalog/external/${item.id}/audit-mark`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ambito: 'precio', accion: 'revisada_ok' })
            });
            if (!res.ok) throw new Error('Error al registrar auditoría');
            const now = new Date().toISOString();
            setItems(prev => prev.map(p => p.id === item.id ? { ...p, ultima_auditoria_precio_el: now, ultima_auditoria_precio_accion: 'revisada_ok', estado_auditoria: 'auditado' } : p));
            setKpis(prev => ({
                ...prev,
                count_sin_auditar: Math.max(0, prev.count_sin_auditar - 1)
            }));
            toast.success(`Precio de ${item.external_item_id} auditado`);
        } catch (e: any) {
            toast.error(e.message || 'Error al auditar precio');
        } finally {
            setAuditingId(null);
        }
    };

    const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

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
                    description={`${kpis.total.toLocaleString()} publicaciones analizadas en servidor`}
                    actions={
                        <div className="flex items-center gap-2">
                            <Link
                                href="/settings/pricing"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors shadow-sm"
                                title="Configurar reglas de precios en cascada"
                            >
                                <Sliders className="w-3.5 h-3.5 text-[var(--accent)]" /> Configurar Reglas V3
                            </Link>
                            <Btn
                                variant="ghost"
                                onClick={() => { loadKpis(); loadPageData(); }}
                                disabled={loading}
                                loading={loading}
                                icon={<RefreshCw className="w-4 h-4" />}
                            >
                                Refrescar
                            </Btn>
                        </div>
                    }
                />

                {/* Tarjetas de Resumen KPI (calculadas al instante en Postgres) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Tarjeta Pérdida */}
                    <div
                        onClick={() => { setActiveTab(activeTab === 'perdida' ? 'all' : 'perdida'); setPage(1); }}
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
                            <span className="text-2xl font-black text-[var(--text)]">{kpis.count_perdida}</span>
                            <span className="text-xs font-semibold text-[var(--err)]">-{formatCurrency(kpis.sum_perdida)} MXN</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">
                            Venta en MeLi por debajo del motor
                        </p>
                    </div>

                    {/* Tarjeta Sobreprecio */}
                    <div
                        onClick={() => { setActiveTab(activeTab === 'sobreprecio' ? 'all' : 'sobreprecio'); setPage(1); }}
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
                            <span className="text-2xl font-black text-[var(--text)]">{kpis.count_sobreprecio}</span>
                            <span className="text-xs font-semibold text-[var(--warn)]">+{formatCurrency(kpis.sum_sobreprecio)} MXN</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">
                            Precio más alto que la regla óptima
                        </p>
                    </div>

                    {/* Tarjeta Sin Precio */}
                    <div
                        onClick={() => { setActiveTab(activeTab === 'sin_precio' ? 'all' : 'sin_precio'); setPage(1); }}
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
                            <span className="text-2xl font-black text-[var(--text)]">{kpis.count_sin_precio}</span>
                            <span className="text-xs text-[var(--text-muted)]">Sin auditar</span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">
                            Publicaciones con precio $0 en vitrina
                        </p>
                    </div>

                    {/* Tarjeta Auditoría Pendiente */}
                    <div
                        onClick={() => { setSoloSinAuditar(prev => !prev); setPage(1); }}
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
                            <span className="text-2xl font-black text-[var(--text)]">{kpis.count_sin_auditar}</span>
                            <span className="text-xs text-[var(--text-muted)]">
                                {kpis.total > 0 ? `${Math.round((kpis.count_sin_auditar / kpis.total) * 100)}%` : '0%'}
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
                            { id: 'all', label: `Todas (${kpis.total})` },
                            { id: 'perdida', label: `🔴 En pérdida (${kpis.count_perdida})` },
                            { id: 'sobreprecio', label: `🟡 Sobreprecio (${kpis.count_sobreprecio})` },
                            { id: 'sin_precio', label: `🟣 Sin precio (${kpis.count_sin_precio})` },
                            { id: 'alineado', label: `🟢 Alineadas (${kpis.count_alineado})` },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id as TabCategory); setPage(1); }}
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
                            onChange={e => { setSortBy(e.target.value as SortOption); setPage(1); }}
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
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Equilibrio Exacto</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Sugerido Final</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right" title="Brecha calculada sobre el Equilibrio Matemático Exacto">Brecha (vs Eq.)</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-center">Auditoría</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {loading ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[var(--accent)]" />
                                            Cargando publicaciones desde el motor...
                                        </td>
                                    </tr>
                                ) : items.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            No se encontraron publicaciones con estos criterios.
                                        </td>
                                    </tr>
                                ) : (
                                    items.map(item => {
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
                                                                href={`/catalog/external/${item.id}?from=${encodeURIComponent(currentUrl)}`}
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
                                                        {formatCurrency(item.draft_cost)}
                                                    </span>
                                                </td>

                                                {/* 4 — PRECIO MELI */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    <div className="text-xs font-bold text-[var(--text)]">
                                                        {item.precio_venta && item.precio_venta > 0 ? formatCurrency(item.precio_venta) : <span className="text-purple-600 font-bold">$0</span>}
                                                    </div>
                                                    {item.original_price && item.precio_venta && item.original_price > item.precio_venta && (
                                                        <div className="text-[10px] text-[var(--text-faint)] line-through">
                                                            {formatCurrency(item.original_price)}
                                                        </div>
                                                    )}
                                                </td>

                                                {/* 5 — EQUILIBRIO EXACTO */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    <span className="text-xs font-mono font-bold text-[var(--accent)]">
                                                        {formatCurrency(item.precio_equilibrio)}
                                                    </span>
                                                    <div className="text-[10px] text-[var(--text-faint)]">
                                                        sin redondeo
                                                    </div>
                                                </td>

                                                {/* 6 — SUGERIDO FINAL */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    <span className="text-xs font-mono font-bold text-[var(--text)]">
                                                        {formatCurrency(item.draft_price)}
                                                    </span>
                                                    <div className="text-[10px] text-[var(--text-faint)]">
                                                        con redondeo
                                                    </div>
                                                </td>

                                                {/* 7 — BRECHA */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    {item.categoria === 'sin_precio' ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-purple-500/10 text-purple-700 border border-purple-500/30">
                                                            Sin precio ($0)
                                                        </span>
                                                    ) : item.categoria === 'perdida' ? (
                                                        <div className="inline-flex flex-col items-end px-2 py-0.5 rounded bg-[var(--err)]/10 text-[var(--err)] border border-[var(--err)]/30">
                                                            <span className="text-xs font-black">{formatCurrency(item.gap_dinero)}</span>
                                                            <span className="text-[10px] font-semibold">{item.gap_pct}%</span>
                                                        </div>
                                                    ) : item.categoria === 'sobreprecio' ? (
                                                        <div className="inline-flex flex-col items-end px-2 py-0.5 rounded bg-[var(--warn)]/10 text-[var(--warn)] border border-[var(--warn)]/30">
                                                            <span className="text-xs font-black">+{formatCurrency(item.gap_dinero)}</span>
                                                            <span className="text-[10px] font-semibold">+{item.gap_pct}%</span>
                                                        </div>
                                                    ) : (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/30">
                                                            Alineado
                                                        </span>
                                                    )}
                                                </td>

                                                {/* 7 — AUDITORÍA */}
                                                <td className="px-4 py-3 align-top text-center">
                                                    {item.estado_auditoria === 'sin_auditar' ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--err)]/15 text-[var(--err)] border border-[var(--err)]/30">
                                                            <AlertCircle className="w-3 h-3" /> Sin auditar
                                                        </span>
                                                    ) : item.estado_auditoria === 'mas_7_dias' ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--warn)]/15 text-[var(--warn)] border border-[var(--warn)]/30" title={`Auditado el ${new Date(item.ultima_auditoria_precio_el!).toLocaleDateString('es-MX')}`}>
                                                            <Clock className="w-3 h-3" /> +7d
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
                                                            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-lg bg-[var(--ok)]/10 hover:bg-[var(--ok)]/20 text-[var(--ok)] border border-[var(--ok)]/30 transition-colors disabled:opacity-50 cursor-pointer"
                                                            title="Marcar como precio revisado y conforme"
                                                        >
                                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                                            {auditingId === item.id ? '...' : 'Auditar'}
                                                        </button>
                                                        <Link
                                                            href={`/catalog/external/${item.id}?from=${encodeURIComponent(currentUrl)}`}
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

                    {/* Paginador Server-Side */}
                    {!loading && totalCount > 0 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--text-muted)]">
                            <div>
                                Mostrando <span className="font-semibold text-[var(--text)]">{((page - 1) * PAGE_SIZE) + 1}</span> a <span className="font-semibold text-[var(--text)]">{Math.min(page * PAGE_SIZE, totalCount)}</span> de <span className="font-semibold text-[var(--text)]">{totalCount.toLocaleString()}</span> resultados
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page <= 1}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium text-[var(--text)]"
                                >
                                    <ChevronLeft className="w-3.5 h-3.5" /> Anterior
                                </button>
                                <span className="px-2 font-medium">
                                    Página {page} de {totalPages}
                                </span>
                                <button
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page >= totalPages}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium text-[var(--text)]"
                                >
                                    Siguiente <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    )}
                </Card>
            </Page>
        </div>
    );
}

export default function UrgenciaPreciosPage() {
    return (
        <Suspense fallback={
            <div className="flex-1 flex items-center justify-center min-h-screen">
                <RefreshCw className="w-8 h-8 animate-spin text-[var(--accent)]" />
            </div>
        }>
            <UrgenciaPreciosInner />
        </Suspense>
    );
}
