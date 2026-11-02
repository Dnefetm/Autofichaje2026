"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import {
    ArrowLeft, AlertCircle, CheckCircle2, Clock, RefreshCw,
    Search, ExternalLink, Package, ArrowUpDown, ChevronLeft, ChevronRight, Sliders,
    CheckSquare, AlertTriangle, X, Zap
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
    tipo_publicacion?: string;
    par_item_id?: string | null;
    id_producto_catalogo?: string | null;
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
type SortOption = 'perdida_desc' | 'sobreprecio_desc' | 'pct_desc' | 'pct_asc' | 'audit_urgente' | 'ventas_desc' | 'ventas_asc' | 'precio_desc' | 'precio_asc' | 'sugerido_desc' | 'sugerido_asc' | 'equilibrio_desc' | 'equilibrio_asc' | 'costo_desc' | 'costo_asc';

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

    // 3. Selección masiva
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectAllUniverse, setSelectAllUniverse] = useState<boolean>(false);
    const [showApproveModal, setShowApproveModal] = useState<boolean>(false);
    const [forceApproval, setForceApproval] = useState<boolean>(false);
    const [approving, setApproving] = useState<boolean>(false);
    const [bulkAuditing, setBulkAuditing] = useState<boolean>(false);

    // 4. Recalculo masivo y edición directa de precio
    const [recalculando, setRecalculando] = useState<boolean>(false);
    const [recalcProgress, setRecalcProgress] = useState<{ done: number; total: number } | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editValue, setEditValue] = useState<string>('');
    const [editSaving, setEditSaving] = useState<boolean>(false);
    const isCancellingRef = useRef<boolean>(false);

    const headerCheckboxRef = useRef<HTMLInputElement>(null);
    // Monótono para descartar respuestas viejas si el usuario cambia de orden rápido.
    const loadReqRef = useRef(0);

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

    // 4. Cargar KPIs (1 llamada rápida al servidor)
    const loadKpis = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('fn_urgencia_precios_kpis');
            if (error) throw error;
            if (data) setKpis(data as UrgenciaKpis);
        } catch (e: any) {
            console.error('Error cargando KPIs de urgencia:', e);
        }
    }, []);

    // 5. Cargar página de datos (servidor: filtra, ordena y pagina 50 filas)
    const loadPageData = useCallback(async () => {
        const reqId = ++loadReqRef.current;
        setLoading(true);
        try {
            // Solo pedir conteo exacto con búsqueda o filtro sin-auditar (filtros que
            // los KPIs no reflejan por pestaña). En navegación normal el total sale de
            // fn_urgencia_precios_kpis en milisegundos y no forzamos el count(*) OVER().
            const necesitaConteo = debouncedSearch.trim().length > 0 || soloSinAuditar;
            let query = supabase
                .from('v_urgencia_precios')
                .select('*', { count: necesitaConteo ? 'exact' : undefined });

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

            // Ordenamiento en servidor (con desempate estable por id).
            if (sortBy === 'perdida_desc') {
                query = query.order('gap_dinero', { ascending: true }).order('id', { ascending: true }); // Más negativo = mayor pérdida
            } else if (sortBy === 'sobreprecio_desc') {
                query = query.order('gap_dinero', { ascending: false }).order('id', { ascending: true }); // Más positivo = mayor sobreprecio
            } else if (sortBy === 'pct_desc') {
                query = query.order('abs_gap_pct', { ascending: false }).order('id', { ascending: true }); // Mayor desviación absoluta
            } else if (sortBy === 'pct_asc') {
                query = query.order('abs_gap_pct', { ascending: true }).order('id', { ascending: true }); // Menor desviación absoluta
            } else if (sortBy === 'audit_urgente') {
                query = query.order('ultima_auditoria_precio_el', { ascending: true, nullsFirst: true }).order('sold_quantity', { ascending: false }).order('id', { ascending: true });
            } else if (sortBy === 'ventas_desc') {
                query = query.order('sold_quantity', { ascending: false }).order('id', { ascending: true });
            } else if (sortBy === 'ventas_asc') {
                query = query.order('sold_quantity', { ascending: true }).order('id', { ascending: true });
            } else if (sortBy === 'precio_desc') {
                query = query.order('precio_venta', { ascending: false, nullsFirst: false }).order('id', { ascending: true });
            } else if (sortBy === 'precio_asc') {
                query = query.order('precio_venta', { ascending: true, nullsFirst: false }).order('id', { ascending: true });
            } else if (sortBy === 'sugerido_desc') {
                query = query.order('draft_price', { ascending: false }).order('id', { ascending: true });
            } else if (sortBy === 'sugerido_asc') {
                query = query.order('draft_price', { ascending: true }).order('id', { ascending: true });
            } else if (sortBy === 'equilibrio_desc') {
                query = query.order('precio_equilibrio', { ascending: false }).order('id', { ascending: true });
            } else if (sortBy === 'equilibrio_asc') {
                query = query.order('precio_equilibrio', { ascending: true }).order('id', { ascending: true });
            } else if (sortBy === 'costo_desc') {
                query = query.order('draft_cost', { ascending: false, nullsFirst: false }).order('id', { ascending: true });
            } else if (sortBy === 'costo_asc') {
                query = query.order('draft_cost', { ascending: true, nullsFirst: false }).order('id', { ascending: true });
            }

            // Paginación server-side (50 filas)
            const from = (page - 1) * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;
            query = query.range(from, to);

            const { data, count, error } = await query;
            if (error) throw error;
            if (reqId !== loadReqRef.current) return; // respuesta vieja, ignorar

            setItems((data as UrgenciaItem[]) || []);
            if (necesitaConteo) {
                setTotalCount(count || 0);
            }
        } catch (e: any) {
            if (reqId !== loadReqRef.current) return; // petición superada por otra más reciente
            console.error(e);
            toast.error(e.message || 'Error al cargar urgencia de precios');
        } finally {
            if (reqId === loadReqRef.current) setLoading(false);
        }
    }, [activeTab, soloSinAuditar, debouncedSearch, sortBy, page]);

    // Cargar primero los datos y diferir KPIs 350ms para no competir por el pool
    // (el rol anon tiene statement_timeout = 3s y la vista en frío roza ese límite).
    useEffect(() => {
        loadPageData();
    }, [loadPageData]);

    useEffect(() => {
        const t = setTimeout(() => { loadKpis(); }, 350);
        return () => clearTimeout(t);
    }, [loadKpis]);

    // Total por pestaña desde KPIs (evita count(*) OVER() en cada navegación).
    useEffect(() => {
        if (debouncedSearch.trim() || soloSinAuditar) return;
        const t = activeTab === 'perdida' ? kpis.count_perdida
            : activeTab === 'sobreprecio' ? kpis.count_sobreprecio
            : activeTab === 'sin_precio' ? kpis.count_sin_precio
            : activeTab === 'alineado' ? kpis.count_alineado
            : kpis.total;
        setTotalCount(t);
    }, [kpis, activeTab, debouncedSearch, soloSinAuditar]);

    // Limpiar selección al cambiar filtros o tabs
    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setSelectAllUniverse(false);
    }, []);

    useEffect(() => {
        clearSelection();
    }, [activeTab, debouncedSearch, soloSinAuditar, clearSelection]);

    // Gestión de Checkbox Cabecera
    const isAllPageSelected = useMemo(() => {
        if (items.length === 0) return false;
        return items.every(item => selectedIds.has(item.id));
    }, [items, selectedIds]);

    const isSomePageSelected = useMemo(() => {
        if (items.length === 0) return false;
        return items.some(item => selectedIds.has(item.id)) && !isAllPageSelected;
    }, [items, selectedIds, isAllPageSelected]);

    useEffect(() => {
        if (headerCheckboxRef.current) {
            headerCheckboxRef.current.indeterminate = isSomePageSelected && !selectAllUniverse;
        }
    }, [isSomePageSelected, selectAllUniverse]);

    const toggleSelectAllPage = () => {
        if (selectAllUniverse) {
            clearSelection();
            return;
        }
        if (isAllPageSelected) {
            setSelectedIds(prev => {
                const next = new Set(prev);
                items.forEach(it => next.delete(it.id));
                return next;
            });
        } else {
            setSelectedIds(prev => {
                const next = new Set(prev);
                items.forEach(it => next.add(it.id));
                return next;
            });
        }
    };

    const toggleSelectItem = (id: string) => {
        if (selectAllUniverse) {
            setSelectAllUniverse(false);
        }
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Quick audit handler individual
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

    // Auditoría Masiva
    const handleBulkAudit = async () => {
        setBulkAuditing(true);
        try {
            let targetIds: string[] = [];
            if (selectAllUniverse) {
                let q = supabase.from('v_urgencia_precios').select('id');
                if (activeTab !== 'all') q = q.eq('categoria', activeTab);
                if (soloSinAuditar) q = q.eq('estado_auditoria', 'sin_auditar');
                if (debouncedSearch.trim()) {
                    const t = debouncedSearch.trim();
                    q = q.or(`titulo.ilike.%${t}%,external_item_id.ilike.%${t}%,seller_custom_field.ilike.%${t}%,seller_sku.ilike.%${t}%,brand.ilike.%${t}%`);
                }
                const { data, error } = await q;
                if (error) throw error;
                targetIds = data?.map(d => d.id) || [];
            } else {
                targetIds = Array.from(selectedIds);
            }

            if (targetIds.length === 0) {
                toast.error('No hay publicaciones seleccionadas');
                return;
            }

            const res = await fetch('/api/catalog/external/bulk-audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: targetIds, ambito: 'precio', accion: 'revisada_ok' })
            });
            const resJson = await res.json();
            if (!res.ok) throw new Error(resJson.error || 'Error al auditar en lote');

            toast.success(resJson.message || `${targetIds.length} publicaciones marcadas como auditadas.`);
            clearSelection();
            loadKpis();
            loadPageData();
        } catch (e: any) {
            toast.error(e.message || 'Error al marcar auditoría');
        } finally {
            setBulkAuditing(false);
        }
    };

    // Confirmación de Aprobación Masiva
    const handleConfirmApprove = async () => {
        setApproving(true);
        try {
            let targetIds: string[] = [];
            if (selectAllUniverse) {
                let q = supabase.from('v_urgencia_precios').select('id');
                if (activeTab !== 'all') q = q.eq('categoria', activeTab);
                if (soloSinAuditar) q = q.eq('estado_auditoria', 'sin_auditar');
                if (debouncedSearch.trim()) {
                    const t = debouncedSearch.trim();
                    q = q.or(`titulo.ilike.%${t}%,external_item_id.ilike.%${t}%,seller_custom_field.ilike.%${t}%,seller_sku.ilike.%${t}%,brand.ilike.%${t}%`);
                }
                const { data, error } = await q;
                if (error) throw error;
                targetIds = data?.map(d => d.id) || [];
            } else {
                targetIds = Array.from(selectedIds);
            }

            if (targetIds.length === 0) {
                toast.error('No hay publicaciones seleccionadas');
                return;
            }

            const res = await fetch('/api/pricing/approve-drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicaciones: targetIds, force: forceApproval })
            });
            const resJson = await res.json();
            if (!res.ok) throw new Error(resJson.error || 'Error al procesar aprobación');

            toast.success(resJson.message || `${targetIds.length} publicaciones aprobadas.`);
            setShowApproveModal(false);
            clearSelection();
            loadKpis();
            loadPageData();
        } catch (e: any) {
            toast.error(e.message || 'Error al aprobar borradores');
        } finally {
            setApproving(false);
        }
    };

    // Recalculo Masivo de Precios Sugeridos (lotes de 200, con barra de progreso)
    const recalcularPrecios = async () => {
        if (recalculando) return;
        setRecalculando(true);
        try {
            let targetIds: string[] = [];
            if (selectAllUniverse) {
                let q = supabase.from('v_urgencia_precios').select('id');
                if (activeTab !== 'all') q = q.eq('categoria', activeTab);
                if (soloSinAuditar) q = q.eq('estado_auditoria', 'sin_auditar');
                if (debouncedSearch.trim()) {
                    const t = debouncedSearch.trim();
                    q = q.or(`titulo.ilike.%${t}%,external_item_id.ilike.%${t}%,seller_custom_field.ilike.%${t}%,seller_sku.ilike.%${t}%,brand.ilike.%${t}%`);
                }
                const { data, error } = await q;
                if (error) throw error;
                targetIds = data?.map((d: any) => d.id) || [];
            } else if (selectedIds.size > 0) {
                targetIds = Array.from(selectedIds);
            } else {
                targetIds = items.map((it) => it.id);
            }

            if (targetIds.length === 0) {
                toast.error('No hay publicaciones para recalcular');
                return;
            }

            const BATCH = 200;
            let done = 0;
            for (let i = 0; i < targetIds.length; i += BATCH) {
                const batch = targetIds.slice(i, i + BATCH);
                setRecalcProgress({ done, total: targetIds.length });
                const res = await fetch('/api/pricing/recalcular-lote', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids: batch })
                });
                const j = await res.json();
                if (!res.ok) throw new Error(j.error || 'Error al recalcular');
                done += batch.length;
            }
            setRecalcProgress({ done, total: targetIds.length });
            toast.success(`${targetIds.length} publicaciones recalculadas.`);
            loadKpis();
            loadPageData();
        } catch (e: any) {
            toast.error(e.message || 'Error al recalcular precios');
        } finally {
            setRecalculando(false);
            setRecalcProgress(null);
        }
    };

    // Guardado de edición directa del precio sugerido (spreadsheet style)
    const guardarEdicion = async (item: UrgenciaItem) => {
        if (isCancellingRef.current || editingId !== item.id) {
            isCancellingRef.current = false;
            return;
        }
        const nuevo = parseFloat(editValue);
        if (!Number.isFinite(nuevo) || nuevo <= 0 || nuevo === item.draft_price) {
            setEditingId(null);
            return;
        }
        setEditSaving(true);
        try {
            const res = await fetch('/api/pricing/edit-draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicacion_id: item.id, nuevo_precio: nuevo })
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.error || 'Error al guardar precio');
            toast.success('Precio guardado');
            setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, draft_price: nuevo } : it)));
            loadKpis();
        } catch (e: any) {
            toast.error(e.message || 'Error al guardar precio');
        } finally {
            setEditSaving(false);
            setEditingId(null);
        }
    };

    // Cálculos para el Modal de Confirmación
    const selectedCount = selectAllUniverse ? totalCount : selectedIds.size;
    const selectedItemsList = useMemo(() => {
        return items.filter(it => selectedIds.has(it.id));
    }, [items, selectedIds]);

    const modalBreakdown = useMemo(() => {
        if (selectAllUniverse) {
            return {
                total: totalCount,
                perdida: activeTab === 'perdida' ? totalCount : kpis.count_perdida,
                sobreprecio: activeTab === 'sobreprecio' ? totalCount : kpis.count_sobreprecio,
                sin_precio: activeTab === 'sin_precio' ? totalCount : kpis.count_sin_precio,
                hasHighDelta: true,
            };
        }
        let perdida = 0;
        let sobreprecio = 0;
        let sin_precio = 0;
        let hasHighDelta = false;

        selectedItemsList.forEach(it => {
            if (it.categoria === 'perdida') perdida++;
            else if (it.categoria === 'sobreprecio') sobreprecio++;
            else if (it.categoria === 'sin_precio') sin_precio++;

            if (Math.abs(it.gap_pct) >= 50) {
                hasHighDelta = true;
            }
        });

        return {
            total: selectedIds.size,
            perdida,
            sobreprecio,
            sin_precio,
            hasHighDelta,
        };
    }, [selectAllUniverse, totalCount, kpis, activeTab, selectedIds.size, selectedItemsList]);

    const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

    return (
        <div className="flex-1 overflow-auto bg-[var(--bg)] min-h-screen pb-24">
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
                    description={`${kpis.total.toLocaleString()} publicaciones analizadas en servidor (vista deduplicada con prioridad tradicional)`}
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
                                variant="primary"
                                onClick={recalcularPrecios}
                                disabled={recalculando}
                                loading={recalculando}
                                icon={<Zap className="w-4 h-4" />}
                            >
                                Recalcular Precios
                            </Btn>
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

                {/* Tarjetas de Resumen KPI */}
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
                                onClick={() => {
                                    setActiveTab(tab.id as TabCategory);
                                    setPage(1);
                                    // Pestañas inteligentes: alinean el orden con la pestaña.
                                    if (tab.id === 'perdida') setSortBy('perdida_desc');
                                    else if (tab.id === 'sobreprecio') setSortBy('sobreprecio_desc');
                                }}
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
                            <optgroup label="Desviación y Brecha">
                                <option value="pct_desc">Mayor desviación (%)</option>
                                <option value="pct_asc">Menor desviación (%)</option>
                                <option value="perdida_desc">Mayor pérdida ($)</option>
                                <option value="sobreprecio_desc">Mayor sobreprecio ($)</option>
                            </optgroup>
                            <optgroup label="Actividad">
                                <option value="ventas_desc">Más vendidos</option>
                                <option value="ventas_asc">Menos vendidos</option>
                                <option value="audit_urgente">Más urgente de auditar</option>
                            </optgroup>
                            {!['pct_desc', 'pct_asc', 'perdida_desc', 'sobreprecio_desc', 'ventas_desc', 'ventas_asc', 'audit_urgente'].includes(sortBy) && (
                                <option value={sortBy} hidden>
                                    {sortBy === 'precio_desc' ? 'Precio MeLi (Mayor a menor)'
                                        : sortBy === 'precio_asc' ? 'Precio MeLi (Menor a mayor)'
                                        : sortBy === 'costo_desc' ? 'Costo Base (Mayor a menor)'
                                        : sortBy === 'costo_asc' ? 'Costo Base (Menor a mayor)'
                                        : sortBy === 'equilibrio_desc' ? 'Equilibrio (Mayor a menor)'
                                        : sortBy === 'equilibrio_asc' ? 'Equilibrio (Menor a mayor)'
                                        : sortBy === 'sugerido_desc' ? 'Sugerido (Mayor a menor)'
                                        : sortBy === 'sugerido_asc' ? 'Sugerido (Menor a mayor)'
                                        : sortBy}
                                </option>
                            )}
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

                {/* Banner de selección de universo cuando toda la página está marcada */}
                {isAllPageSelected && totalCount > items.length && (
                    <div className="p-3 bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-xl text-xs flex items-center justify-between gap-2 text-[var(--text)] animate-in fade-in">
                        <div>
                            {selectAllUniverse ? (
                                <span>
                                    Están seleccionadas las <strong>{totalCount.toLocaleString()}</strong> publicaciones de este filtro.
                                </span>
                            ) : (
                                <span>
                                    Has seleccionado las <strong>{items.length}</strong> publicaciones de esta página.
                                </span>
                            )}
                        </div>
                        <div>
                            {selectAllUniverse ? (
                                <button
                                    onClick={clearSelection}
                                    className="font-bold text-[var(--accent)] hover:underline ml-2"
                                >
                                    Limpiar selección
                                </button>
                            ) : (
                                <button
                                    onClick={() => setSelectAllUniverse(true)}
                                    className="font-bold text-[var(--accent)] hover:underline ml-2"
                                >
                                    Seleccionar las {totalCount.toLocaleString()} publicaciones de este filtro
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* Tabla Principal de Urgencia */}
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] border-b border-[var(--border)]">
                                <tr>
                                    <th className="px-3 py-3 w-10 text-center">
                                        <input
                                            type="checkbox"
                                            ref={headerCheckboxRef}
                                            checked={isAllPageSelected}
                                            onChange={toggleSelectAllPage}
                                            className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
                                            title="Seleccionar / deseleccionar página actual"
                                        />
                                    </th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Producto</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider">Estado</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">
                                        <button onClick={() => setSortBy(sortBy === 'costo_desc' ? 'costo_asc' : 'costo_desc')} className="uppercase tracking-wider hover:text-[var(--accent)] cursor-pointer">Costo Base{sortBy === 'costo_desc' ? ' ▼' : sortBy === 'costo_asc' ? ' ▲' : ''}</button>
                                    </th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">
                                        <button onClick={() => setSortBy(sortBy === 'precio_desc' ? 'precio_asc' : 'precio_desc')} className="uppercase tracking-wider hover:text-[var(--accent)] cursor-pointer">Precio MeLi{sortBy === 'precio_desc' ? ' ▼' : sortBy === 'precio_asc' ? ' ▲' : ''}</button>
                                    </th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">
                                        <button onClick={() => setSortBy(sortBy === 'equilibrio_desc' ? 'equilibrio_asc' : 'equilibrio_desc')} className="uppercase tracking-wider hover:text-[var(--accent)] cursor-pointer">Equilibrio Exacto{sortBy === 'equilibrio_desc' ? ' ▼' : sortBy === 'equilibrio_asc' ? ' ▲' : ''}</button>
                                    </th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">
                                        <button onClick={() => setSortBy(sortBy === 'sugerido_desc' ? 'sugerido_asc' : 'sugerido_desc')} className="uppercase tracking-wider hover:text-[var(--accent)] cursor-pointer">Sugerido Final{sortBy === 'sugerido_desc' ? ' ▼' : sortBy === 'sugerido_asc' ? ' ▲' : ''}</button>
                                    </th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right" title="Brecha calculada sobre el Equilibrio Matemático Exacto">
                                        <button onClick={() => setSortBy(sortBy === 'pct_desc' ? 'pct_asc' : 'pct_desc')} className="uppercase tracking-wider hover:text-[var(--accent)] cursor-pointer">Brecha (vs Eq.){sortBy === 'pct_desc' ? ' ▼' : sortBy === 'pct_asc' ? ' ▲' : ''}</button>
                                    </th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-center">Auditoría</th>
                                    <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-right">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {loading ? (
                                    <tr>
                                        <td colSpan={10} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[var(--accent)]" />
                                            Cargando publicaciones desde el motor...
                                        </td>
                                    </tr>
                                ) : items.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            No se encontraron publicaciones con estos criterios.
                                        </td>
                                    </tr>
                                ) : (
                                    items.map(item => {
                                        const sku = item.seller_custom_field || item.seller_sku;
                                        const isSelected = selectAllUniverse || selectedIds.has(item.id);
                                        return (
                                            <tr
                                                key={item.id}
                                                className={cn(
                                                    "transition-colors",
                                                    isSelected ? "bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10" : "hover:bg-[var(--surface-2)]/60"
                                                )}
                                            >
                                                {/* 0 — SELECCIÓN */}
                                                <td className="px-3 py-3 align-top text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => toggleSelectItem(item.id)}
                                                        className="w-4 h-4 rounded border-[var(--border)] text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
                                                    />
                                                </td>

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
                                                                {item.tipo_publicacion === 'catalogo' && (
                                                                    <span className="text-[9px] font-bold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 px-1 py-0.5 rounded" title="Publicación de catálogo única (sin par tradicional activa)">
                                                                        Catálogo
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

                                                {/* 6 — SUGERIDO FINAL (celda editable directa) */}
                                                <td className="px-4 py-3 align-top text-right">
                                                    {editingId === item.id ? (
                                                        <input
                                                            type="text"
                                                            inputMode="decimal"
                                                            autoFocus
                                                            value={editValue}
                                                            onChange={(e) => {
                                                                const val = e.target.value.replace(/[^0-9.]/g, '');
                                                                const parts = val.split('.');
                                                                if (parts.length > 2) return;
                                                                setEditValue(val);
                                                            }}
                                                            onFocus={(e) => e.currentTarget.select()}
                                                            onKeyDown={(e) => {
                                                                if (e.key === 'Enter') {
                                                                    e.preventDefault();
                                                                    e.currentTarget.blur();
                                                                } else if (e.key === 'Escape') {
                                                                    e.preventDefault();
                                                                    isCancellingRef.current = true;
                                                                    setEditingId(null);
                                                                }
                                                            }}
                                                            onBlur={() => guardarEdicion(item)}
                                                            disabled={editSaving}
                                                            className="w-24 text-right text-xs font-mono font-bold bg-[var(--surface-2)] text-[var(--text)] border-2 border-[var(--accent)] rounded px-1.5 py-0.5 outline-none shadow-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                        />
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                isCancellingRef.current = false;
                                                                setEditingId(item.id);
                                                                setEditValue(String(item.draft_price));
                                                            }}
                                                            className="text-xs font-mono font-bold text-[var(--text)] hover:text-[var(--accent)] hover:underline cursor-text transition-colors"
                                                            title="Clic para editar precio sugerido"
                                                        >
                                                            {formatCurrency(item.draft_price)}
                                                        </button>
                                                    )}
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

                                                {/* 8 — AUDITORÍA */}
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

                                                {/* 9 — ACCIÓN */}
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

                {/* Barra Flotante de Acciones Masivas */}
                {(selectedIds.size > 0 || selectAllUniverse) && (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-2xl w-full px-4 animate-in slide-in-from-bottom-4 duration-200">
                        <div className="bg-[var(--surface)]/95 backdrop-blur-md border-2 border-[var(--accent)] shadow-2xl rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--accent)] animate-pulse" />
                                <span className="text-xs sm:text-sm font-bold text-[var(--text)]">
                                    {selectedCount.toLocaleString()} {selectedCount === 1 ? 'publicación seleccionada' : 'publicaciones seleccionadas'}
                                </span>
                                {selectAllUniverse && (
                                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30">
                                        Universo completo
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                                <button
                                    onClick={clearSelection}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleBulkAudit}
                                    disabled={bulkAuditing || approving}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--ok)]/15 hover:bg-[var(--ok)]/25 text-[var(--ok)] border border-[var(--ok)]/30 transition-colors disabled:opacity-50 cursor-pointer"
                                >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {bulkAuditing ? 'Auditando...' : 'Marcar OK'}
                                </button>
                                <button
                                    onClick={() => setShowApproveModal(true)}
                                    disabled={bulkAuditing || approving}
                                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover,var(--accent))] text-white shadow-md shadow-[var(--accent)]/20 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                    <CheckSquare className="w-3.5 h-3.5" />
                                    Aprobar Sugeridos
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modal de Confirmación de Aprobación Masiva */}
                {recalcProgress && (
                    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl p-4 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-[var(--text)] flex items-center gap-1.5">
                                    <Zap className="w-3.5 h-3.5 text-[var(--accent)]" /> Recalculando en Supabase…
                                </span>
                                <span className="font-mono text-[var(--text-muted)]">
                                    {recalcProgress.done.toLocaleString()} / {recalcProgress.total.toLocaleString()} ({recalcProgress.total > 0 ? Math.round((recalcProgress.done / recalcProgress.total) * 100) : 0}%)
                                </span>
                            </div>
                            <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                                    style={{ width: `${recalcProgress.total > 0 ? (recalcProgress.done / recalcProgress.total) * 100 : 0}%` }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {showApproveModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
                            <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                                <div className="flex items-center gap-2">
                                    <CheckSquare className="w-5 h-5 text-[var(--accent)]" />
                                    <h3 className="text-base font-bold text-[var(--text)]">
                                        Aprobar Precios Sugeridos ({selectedCount.toLocaleString()})
                                    </h3>
                                </div>
                                <button
                                    onClick={() => setShowApproveModal(false)}
                                    className="p-1 rounded-lg text-[var(--text-faint)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                                Se aplicará el precio sugerido del auditor de precios a las <strong>{selectedCount.toLocaleString()}</strong> publicaciones seleccionadas.
                            </p>

                            {/* Desglose */}
                            <div className="grid grid-cols-3 gap-2 py-2">
                                <div className="p-2.5 rounded-xl bg-[var(--err)]/10 border border-[var(--err)]/20 text-center">
                                    <span className="text-xs font-bold text-[var(--err)] block">Subprecio / Pérdida</span>
                                    <span className="text-base font-black text-[var(--text)] mt-0.5 block">{modalBreakdown.perdida}</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-[var(--warn)]/10 border border-[var(--warn)]/20 text-center">
                                    <span className="text-xs font-bold text-[var(--warn)] block">Sobreprecio</span>
                                    <span className="text-base font-black text-[var(--text)] mt-0.5 block">{modalBreakdown.sobreprecio}</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-center">
                                    <span className="text-xs font-bold text-purple-700 dark:text-purple-300 block">Sin Precio</span>
                                    <span className="text-base font-black text-[var(--text)] mt-0.5 block">{modalBreakdown.sin_precio}</span>
                                </div>
                            </div>

                            {/* Aviso de variación alta */}
                            {modalBreakdown.hasHighDelta && (
                                <div className="p-3 bg-[var(--warn)]/10 border border-[var(--warn)]/30 rounded-xl text-xs space-y-2">
                                    <div className="flex items-center gap-2 font-bold text-[var(--warn)]">
                                        <AlertTriangle className="w-4 h-4 shrink-0" />
                                        <span>Variaciones de precio significativas (&gt; 50%)</span>
                                    </div>
                                    <p className="text-[var(--text-muted)] leading-relaxed">
                                        Existen publicaciones con variación de precio mayor al 50%. Por protección del motor, estos cambios requieren confirmación explícita.
                                    </p>
                                    <label className="flex items-center gap-2 pt-2 border-t border-[var(--warn)]/20 cursor-pointer font-medium text-[var(--text)]">
                                        <input
                                            type="checkbox"
                                            checked={forceApproval}
                                            onChange={e => setForceApproval(e.target.checked)}
                                            className="w-4 h-4 rounded text-[var(--accent)] focus:ring-[var(--accent)] cursor-pointer"
                                        />
                                        <span>Forzar aprobación de cambios mayores al 50%</span>
                                    </label>
                                </div>
                            )}

                            {/* Explicación de Sincronización en Espejo */}
                            <div className="p-3 bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-xl text-xs space-y-1">
                                <div className="font-bold text-[var(--accent)] flex items-center gap-1.5">
                                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                                    <span>Sincronización Inteligente en Espejo</span>
                                </div>
                                <p className="text-[var(--text-muted)] leading-relaxed">
                                    Se sincronizarán a Mercado Libre únicamente las publicaciones tradicionales. Los pares de catálogo se actualizarán de forma nativa en Mercado Libre y quedarán aprobados en la base de datos sin llamadas redundantes.
                                </p>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-2">
                                <button
                                    onClick={() => setShowApproveModal(false)}
                                    disabled={approving}
                                    className="px-4 py-2 text-xs font-semibold rounded-xl border border-[var(--border)] hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleConfirmApprove}
                                    disabled={approving}
                                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover,var(--accent))] text-white shadow-md shadow-[var(--accent)]/20 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                    {approving ? (
                                        <>
                                            <RefreshCw className="w-4 h-4 animate-spin" />
                                            Aprobando...
                                        </>
                                    ) : (
                                        <>
                                            <CheckSquare className="w-4 h-4" />
                                            Confirmar y Aplicar Precios
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
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
