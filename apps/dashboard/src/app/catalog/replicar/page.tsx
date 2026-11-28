'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
    Copy, Search, RefreshCw, Activity, ArrowRight, CheckCircle2,
    AlertCircle, ShieldAlert, Sparkles, Package, Layers, SlidersHorizontal, ExternalLink, X
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Page } from '@/components/ui/Page';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Btn } from '@/components/ui/Btn';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
    DEFAULT_REPLICATION_POLICIES,
    PreflightItem,
    ReplicationPolicies,
} from '@/lib/replication-batch';
import { BatchMonitorDrawer } from './batch-monitor-drawer';

interface Account {
    id: string;
    account_name: string;
}

const MAX_BATCH = 50;

function ReplicarContent() {
    const searchParams = useSearchParams();
    const initialIdsParam = searchParams.get('ids') || '';
    const initialSourceParam = searchParams.get('source') || '';

    const [accounts, setAccounts] = useState<Account[]>([]);
    const [sourceId, setSourceId] = useState('');
    const [targetId, setTargetId] = useState('');
    const [directIds, setDirectIds] = useState<string[]>(() =>
        initialIdsParam
            ? Array.from(new Set(initialIdsParam.split(',').map(s => s.trim()).filter(Boolean))).slice(0, MAX_BATCH)
            : [],
    );

    // Filtros
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [brand, setBrand] = useState('');
    const [categoryId, setCategoryId] = useState('');
    const [catalogFilter, setCatalogFilter] = useState('all');
    const [mappedFilter, setMappedFilter] = useState('all');
    const [stockFilter, setStockFilter] = useState('all');
    const [facets, setFacets] = useState<{ brands: string[]; categories: string[] }>({ brands: [], categories: [] });

    // Datos y paginación
    const [items, setItems] = useState<any[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [page, setPage] = useState(0);
    const [loading, setLoading] = useState(false);

    // Selección persistente entre páginas (máx 50 por bloque)
    const [selectedMap, setSelectedMap] = useState<Map<string, any>>(new Map());

    // Políticas del lote
    const [policies, setPolicies] = useState<ReplicationPolicies>(DEFAULT_REPLICATION_POLICIES);

    // Pre-vuelo
    const [preflightOpen, setPreflightOpen] = useState(false);
    const [preflightLoading, setPreflightLoading] = useState(false);
    const [preflightResult, setPreflightResult] = useState<{ summary: any; items: PreflightItem[] } | null>(null);
    const [preflightCheckedIds, setPreflightCheckedIds] = useState<Set<string>>(new Set());
    const [forceDupIds, setForceDupIds] = useState<Set<string>>(new Set());
    const [enqueuing, setEnqueuing] = useState(false);

    // Monitor Drawer
    const [monitorOpen, setMonitorOpen] = useState(false);
    const [activeBatchId, setActiveBatchId] = useState<string | null>(null);

    // Debounce búsqueda
    useEffect(() => {
        const t = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(0);
        }, 350);
        return () => clearTimeout(t);
    }, [search]);

    // Cargar cuentas activas
    useEffect(() => {
        supabase
            .from('marketplace_configs')
            .select('id, account_name')
            .eq('is_active', true)
            .order('account_name')
            .then(({ data }) => {
                const list = data || [];
                setAccounts(list);
                if (list.length >= 2) {
                    const src = (initialSourceParam && list.find(a => a.id === initialSourceParam))
                        || list.find(a => /histo/i.test(a.account_name))
                        || list[0];
                    const dst = list.find(a => a.id !== src.id) || list[1];
                    setSourceId(src.id);
                    setTargetId(dst.id);
                } else if (list.length === 1) {
                    setSourceId(list[0].id);
                }
            });
    }, [initialSourceParam]);

    // Cargar facetas al cambiar cuenta origen
    useEffect(() => {
        if (!sourceId) return;
        fetch(`/api/catalog/replicar/candidates?source_marketplace_id=${encodeURIComponent(sourceId)}&target_marketplace_id=${encodeURIComponent(targetId || sourceId)}&include_facets=1&limit=1`)
            .then(r => r.json())
            .then(d => {
                if (d?.facets) setFacets(d.facets);
            })
            .catch(() => {});
    }, [sourceId]);

    // Cargar candidatas
    async function loadCandidates(targetPage = page) {
        if (!sourceId || !targetId || sourceId === targetId) return;
        setLoading(true);
        try {
            const qs = new URLSearchParams({
                source_marketplace_id: sourceId,
                target_marketplace_id: targetId,
                limit: String(MAX_BATCH),
                offset: String(targetPage * MAX_BATCH),
            });
            if (directIds.length > 0) {
                qs.set('ids', directIds.join(','));
            } else {
                if (debouncedSearch.trim()) qs.set('search', debouncedSearch.trim());
                if (brand) qs.set('brand', brand);
                if (categoryId) qs.set('category_id', categoryId);
                if (catalogFilter !== 'all') qs.set('catalog_filter', catalogFilter);
                if (mappedFilter !== 'all') qs.set('mapped_filter', mappedFilter);
                if (stockFilter !== 'all') qs.set('stock_filter', stockFilter);
            }
            const res = await fetch(`/api/catalog/replicar/candidates?${qs.toString()}`);
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || 'Error cargando candidatas');
            const rows = data.items || [];
            setItems(rows);
            setTotalCount(Number(data.total_count || rows.length));

            // Si entramos en modo directo (?ids=...), preseleccionar automáticamente
            if (directIds.length > 0 && selectedMap.size === 0 && rows.length > 0) {
                const nextMap = new Map<string, any>();
                for (const r of rows.slice(0, MAX_BATCH)) {
                    nextMap.set(r.publicacion_id, r);
                }
                setSelectedMap(nextMap);
            }
        } catch (err: any) {
            toast.error(err?.message || 'Error consultando candidatas');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadCandidates(page);
    }, [sourceId, targetId, page, debouncedSearch, brand, categoryId, catalogFilter, mappedFilter, stockFilter, directIds]);

    function swapAccounts() {
        if (!sourceId || !targetId) return;
        setSourceId(targetId);
        setTargetId(sourceId);
        setSelectedMap(new Map());
        setDirectIds([]);
        setPage(0);
    }

    function toggleSelectRow(item: any) {
        setSelectedMap(prev => {
            const next = new Map(prev);
            if (next.has(item.publicacion_id)) {
                next.delete(item.publicacion_id);
            } else {
                if (next.size >= MAX_BATCH) {
                    toast.warning(`Máximo ${MAX_BATCH} publicaciones por lote`);
                    return prev;
                }
                next.set(item.publicacion_id, item);
            }
            return next;
        });
    }

    function selectVisibleUpToLimit() {
        setSelectedMap(prev => {
            const next = new Map(prev);
            for (const it of items) {
                if (next.size >= MAX_BATCH) break;
                if (!next.has(it.publicacion_id)) next.set(it.publicacion_id, it);
            }
            return next;
        });
    }

    const allVisibleSelected = useMemo(
        () => items.length > 0 && items.every(it => selectedMap.has(it.publicacion_id)),
        [items, selectedMap],
    );

    function toggleSelectVisible() {
        if (allVisibleSelected) {
            setSelectedMap(prev => {
                const next = new Map(prev);
                for (const it of items) next.delete(it.publicacion_id);
                return next;
            });
        } else {
            selectVisibleUpToLimit();
        }
    }

    async function runPreflight() {
        if (selectedMap.size === 0) {
            toast.warning('Selecciona al menos 1 publicación para validar');
            return;
        }
        setPreflightOpen(true);
        setPreflightLoading(true);
        setPreflightResult(null);
        try {
            const res = await fetch('/api/catalog/replicar/preflight', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_marketplace_id: sourceId,
                    target_marketplace_id: targetId,
                    publicacion_ids: Array.from(selectedMap.keys()),
                    policies,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || 'Error en pre-vuelo');
            setPreflightResult({ summary: data.summary, items: data.items || [] });
            const readyIds = new Set<string>(
                (data.items || [])
                    .filter((i: PreflightItem) => i.status !== 'blocker')
                    .map((i: PreflightItem) => i.publicacion_id),
            );
            setPreflightCheckedIds(readyIds);
            setForceDupIds(new Set());
        } catch (err: any) {
            toast.error(err?.message || 'Error ejecutando pre-vuelo');
            setPreflightOpen(false);
        } finally {
            setPreflightLoading(false);
        }
    }

    async function confirmAndStartBatch() {
        const idsToQueue = Array.from(preflightCheckedIds);
        if (idsToQueue.length === 0) {
            toast.warning('No hay ítems marcados sin bloqueadores para encolar');
            return;
        }
        setEnqueuing(true);
        try {
            const res = await fetch('/api/catalog/replicar/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_marketplace_id: sourceId,
                    target_marketplace_id: targetId,
                    publicacion_ids: idsToQueue,
                    force_duplicate_ids: Array.from(forceDupIds),
                    policies,
                }),
            });
            const data = await res.json();
            if (!res.ok || !data?.ok) throw new Error(data?.error || 'Error al iniciar lote');
            toast.success(`Lote iniciado: ${data.queued_count} publicación(es) en cola`);
            setPreflightOpen(false);
            setSelectedMap(new Map());
            setDirectIds([]);
            setActiveBatchId(data.batch_id);
            setMonitorOpen(true);
        } catch (err: any) {
            toast.error(err?.message || 'Error iniciando lote');
        } finally {
            setEnqueuing(false);
        }
    }

    const fmtMoney = (v: any) =>
        v != null && !isNaN(Number(v))
            ? `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
            : '—';

    return (
        <div className="flex-1 overflow-auto bg-[var(--bg)] min-h-screen">
            <Page>
                <PageHeader
                    title="Replicar Publicaciones entre Cuentas"
                    description={
                        directIds.length > 0
                            ? `Modo selección directa desde Vitrinas (${items.length} ítems)`
                            : `${totalCount.toLocaleString()} candidatas pendientes en origen (${Math.ceil(totalCount / MAX_BATCH)} bloques de ${MAX_BATCH})`
                    }
                    actions={
                        <div className="flex flex-wrap gap-2">
                            <Btn variant="ghost" onClick={() => setMonitorOpen(true)} icon={<Activity className="w-4 h-4" />}>
                                Monitor de Lotes
                            </Btn>
                            <Link
                                href="/catalog/external"
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)]"
                            >
                                ← Volver a Vitrinas
                            </Link>
                        </div>
                    }
                />

                {/* Barra Origen -> Destino */}
                <Card className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-end">
                        <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">Cuenta Origen (lee)</span>
                            <select
                                value={sourceId}
                                onChange={e => {
                                    setSourceId(e.target.value);
                                    setSelectedMap(new Map());
                                    setPage(0);
                                }}
                                className="mt-1 w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] font-semibold"
                            >
                                {accounts.map(a => (
                                    <option key={a.id} value={a.id}>{a.account_name}</option>
                                ))}
                            </select>
                        </label>

                        <button
                            type="button"
                            onClick={swapAccounts}
                            className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] hover:bg-[var(--surface)] text-xs font-bold flex items-center justify-center gap-1.5"
                            title="Intercambiar Origen y Destino"
                        >
                            <ArrowRight className="w-4 h-4 text-[var(--accent)]" /> Invertir
                        </button>

                        <label className="block">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">Cuenta Destino (publica)</span>
                            <select
                                value={targetId}
                                onChange={e => {
                                    setTargetId(e.target.value);
                                    setSelectedMap(new Map());
                                    setPage(0);
                                }}
                                className="mt-1 w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] font-semibold"
                            >
                                {accounts.filter(a => a.id !== sourceId).map(a => (
                                    <option key={a.id} value={a.id}>{a.account_name}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {directIds.length > 0 && (
                        <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[var(--info)]/10 border border-[var(--info)]/30 text-xs text-[var(--info)]">
                            <span>
                                Mostrando <strong>{directIds.length}</strong> publicación(es) seleccionadas desde Vitrinas de MeLi.
                            </span>
                            <button
                                type="button"
                                onClick={() => {
                                    setDirectIds([]);
                                    setSelectedMap(new Map());
                                    setPage(0);
                                }}
                                className="font-bold underline"
                            >
                                Ver todas las candidatas faltantes
                            </button>
                        </div>
                    )}

                    {/* Políticas del lote */}
                    <div className="p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] space-y-2.5">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                            <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--accent)]" />
                            Políticas de este bloque (máx {MAX_BATCH})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                            <label className="block">
                                <span className="text-[10px] font-semibold text-[var(--text-faint)]">Precio en destino</span>
                                <select
                                    value={policies.price_policy}
                                    onChange={e => setPolicies(p => ({ ...p, price_policy: e.target.value as any }))}
                                    className="mt-0.5 w-full px-2.5 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                                >
                                    <option value="target_engine">Motor V2 cuenta destino</option>
                                    <option value="keep_source">Conservar precio origen</option>
                                </select>
                            </label>
                            <label className="block">
                                <span className="text-[10px] font-semibold text-[var(--text-faint)]">Catálogo MeLi</span>
                                <select
                                    value={policies.catalog_policy}
                                    onChange={e => setPolicies(p => ({ ...p, catalog_policy: e.target.value as any }))}
                                    className="mt-0.5 w-full px-2.5 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                                >
                                    <option value="auto_catalog">Tradicional + Catálogo (auto GTIN + optin)</option>
                                    <option value="traditional_only">Solo Tradicional</option>
                                </select>
                            </label>
                            <label className="block">
                                <span className="text-[10px] font-semibold text-[var(--text-faint)]">Título / family_name</span>
                                <select
                                    value={policies.title_policy}
                                    onChange={e => setPolicies(p => ({ ...p, title_policy: e.target.value as any }))}
                                    className="mt-0.5 w-full px-2.5 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                                >
                                    <option value="ai_60">Optimizar IA (&quot;Título ML 60&quot;)</option>
                                    <option value="keep_source">Conservar título origen</option>
                                </select>
                            </label>
                            <label className="block">
                                <span className="text-[10px] font-semibold text-[var(--text-faint)]">Estado inicial</span>
                                <select
                                    value={policies.initial_state_policy}
                                    onChange={e => setPolicies(p => ({ ...p, initial_state_policy: e.target.value as any }))}
                                    className="mt-0.5 w-full px-2.5 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                                >
                                    <option value="active">Activas (con stock físico real)</option>
                                    <option value="paused">Crear pausadas para revisión</option>
                                </select>
                            </label>
                        </div>
                        <label className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer">
                            <input
                                type="checkbox"
                                checked={policies.stock_buffer_two_accounts}
                                onChange={e => setPolicies(p => ({ ...p, stock_buffer_two_accounts: e.target.checked }))}
                                className="w-3.5 h-3.5 rounded text-[var(--accent)]"
                            />
                            <span>Buffer anti-sobreventa: si el stock físico es 1 pieza o el origen es Full sin stock local, nacer pausada en 0 en destino.</span>
                        </label>
                    </div>

                    {/* Filtros (ocultos en modo selección directa) */}
                    {directIds.length === 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs">
                            <div className="relative lg:col-span-2">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    placeholder="Buscar título, MLM, SKU, marca, artículo…"
                                    className="w-full pl-8 pr-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                                />
                            </div>
                            <select
                                value={brand}
                                onChange={e => { setBrand(e.target.value); setPage(0); }}
                                className="px-2.5 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                            >
                                <option value="">Todas las marcas</option>
                                {facets.brands.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                            <select
                                value={categoryId}
                                onChange={e => { setCategoryId(e.target.value); setPage(0); }}
                                className="px-2.5 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] font-mono"
                            >
                                <option value="">Todas categorías</option>
                                {facets.categories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select
                                value={catalogFilter}
                                onChange={e => { setCatalogFilter(e.target.value); setPage(0); }}
                                className="px-2.5 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                            >
                                <option value="all">Catálogo: Todos</option>
                                <option value="with_catalog">Con catálogo vinculado</option>
                                <option value="without_catalog">Solo tradicional</option>
                            </select>
                            <div className="flex gap-1.5">
                                <select
                                    value={mappedFilter}
                                    onChange={e => { setMappedFilter(e.target.value); setPage(0); }}
                                    className="flex-1 px-2 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                                >
                                    <option value="all">Mapeo: Todos</option>
                                    <option value="mapped">Mapeadas</option>
                                    <option value="unmapped">Sin mapear</option>
                                </select>
                                <select
                                    value={stockFilter}
                                    onChange={e => { setStockFilter(e.target.value); setPage(0); }}
                                    className="flex-1 px-2 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)]"
                                >
                                    <option value="all">Stock: Todos</option>
                                    <option value="with_stock">Con stock</option>
                                    <option value="non_full">No Full</option>
                                    <option value="full">Solo Full</option>
                                </select>
                            </div>
                        </div>
                    )}
                </Card>

                {/* Barra de selección actual */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                    <div className="flex items-center gap-2 text-xs">
                        <span className="font-bold text-[var(--text)]">
                            Seleccionadas: <span className="text-[var(--accent)] font-mono">{selectedMap.size}/{MAX_BATCH}</span>
                        </span>
                        <button
                            type="button"
                            onClick={selectVisibleUpToLimit}
                            className="px-2.5 py-1 rounded border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] font-semibold"
                        >
                            Seleccionar bloque (hasta {MAX_BATCH})
                        </button>
                        {selectedMap.size > 0 && (
                            <button
                                type="button"
                                onClick={() => setSelectedMap(new Map())}
                                className="px-2.5 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--err)]"
                            >
                                Limpiar selección
                            </button>
                        )}
                    </div>

                    <Btn
                        onClick={runPreflight}
                        disabled={selectedMap.size === 0 || !sourceId || !targetId || sourceId === targetId}
                        icon={<Sparkles className="w-4 h-4" />}
                    >
                        Pre-vuelo y Copiar ({selectedMap.size})
                    </Btn>
                </div>

                {/* Tabla de candidatas */}
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] border-b border-[var(--border)]">
                                <tr>
                                    <th className="px-3 py-3 w-10">
                                        <input
                                            type="checkbox"
                                            checked={allVisibleSelected}
                                            onChange={toggleSelectVisible}
                                            className="w-4 h-4 rounded text-[var(--accent)]"
                                            title="Seleccionar / deseleccionar visibles"
                                        />
                                    </th>
                                    <th className="px-3 py-3 font-bold uppercase text-[10px]">Publicación Origen</th>
                                    <th className="px-3 py-3 font-bold uppercase text-[10px]">Marca / Cat. / SKU</th>
                                    <th className="px-3 py-3 font-bold uppercase text-[10px]">Mapeo / GTIN / SAT</th>
                                    <th className="px-3 py-3 font-bold uppercase text-[10px]">Precio / Stock</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                                {loading ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[var(--accent)]" />
                                            Consultando candidatas en índice…
                                        </td>
                                    </tr>
                                ) : items.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-[var(--text-faint)]">
                                            No hay publicaciones pendientes con estos filtros.
                                        </td>
                                    </tr>
                                ) : (
                                    items.map(it => {
                                        const checked = selectedMap.has(it.publicacion_id);
                                        const effectiveGtin = it.gtin || it.articulo_codigo_universal;
                                        return (
                                            <tr
                                                key={it.publicacion_id}
                                                onClick={() => toggleSelectRow(it)}
                                                className={cn(
                                                    'cursor-pointer transition-colors hover:bg-[var(--bg)]/70',
                                                    checked && 'bg-[var(--accent)]/5',
                                                )}
                                            >
                                                <td className="px-3 py-2.5 align-top" onClick={e => e.stopPropagation()}>
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleSelectRow(it)}
                                                        className="w-4 h-4 rounded text-[var(--accent)]"
                                                    />
                                                </td>
                                                <td className="px-3 py-2.5 align-top max-w-sm">
                                                    <div className="flex items-start gap-2.5">
                                                        {it.url_imagen ? (
                                                            <img src={it.url_imagen} alt="" className="w-10 h-10 rounded object-cover border border-[var(--border)] shrink-0" />
                                                        ) : (
                                                            <div className="w-10 h-10 rounded bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0">
                                                                <Package className="w-4 h-4 text-[var(--text-faint)]" />
                                                            </div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <p className="font-semibold text-[var(--text)] line-clamp-2">{it.titulo}</p>
                                                            <div className="flex flex-wrap gap-1.5 mt-1">
                                                                <span className="font-mono text-[10px] text-[var(--text-faint)]">{it.external_item_id}</span>
                                                                {it.effective_catalog_product_id && (
                                                                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-[var(--ok)]/10 text-[var(--ok)] font-semibold">
                                                                        <Layers className="w-2.5 h-2.5" /> {it.effective_catalog_product_id}
                                                                    </span>
                                                                )}
                                                                {Number(it.variations_count || 0) > 0 && (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--warn)]/10 text-[var(--warn)] font-semibold">
                                                                        +{it.variations_count} var.
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2.5 align-top">
                                                    <p className="font-semibold text-[var(--text-muted)]">{it.brand || '—'}</p>
                                                    <p className="font-mono text-[10px] text-[var(--text-faint)]">{it.category_id || '—'}</p>
                                                    {it.seller_sku && <p className="font-mono text-[10px] text-[var(--text)] mt-0.5">SKU: {it.seller_sku}</p>}
                                                </td>
                                                <td className="px-3 py-2.5 align-top">
                                                    {it.articulo_id ? (
                                                        <p className="font-mono text-[10px] font-bold text-[var(--ok)]">
                                                            {it.articulo_id} (×{it.cantidad_requerida || 1})
                                                        </p>
                                                    ) : (
                                                        <p className="text-[10px] text-[var(--warn)] font-semibold">Sin mapear</p>
                                                    )}
                                                    <p className="font-mono text-[10px] text-[var(--text-muted)] mt-0.5">
                                                        GTIN: {effectiveGtin || '—'}
                                                    </p>
                                                    {it.articulo_codigo_sat && (
                                                        <p className="font-mono text-[10px] text-[var(--text-faint)]">SAT: {it.articulo_codigo_sat}</p>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2.5 align-top">
                                                    <p className="font-bold text-[var(--text)]">{fmtMoney(it.precio_venta)}</p>
                                                    <p className="text-[10px] text-[var(--text-muted)]">
                                                        Origen: {it.stock_publicado ?? '—'} {it.logistic_type === 'fulfillment' ? '(Full)' : ''}
                                                    </p>
                                                    {it.local_stock != null && (
                                                        <p className="text-[10px] text-[var(--info)]">Físico local: {it.local_stock}</p>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </Card>

                {/* Paginación */}
                {directIds.length === 0 && totalCount > MAX_BATCH && (
                    <div className="flex items-center justify-between text-xs">
                        <p className="text-[var(--text-muted)]">
                            Mostrando {page * MAX_BATCH + 1} – {Math.min((page + 1) * MAX_BATCH, totalCount)} de {totalCount.toLocaleString()}
                        </p>
                        <div className="flex gap-2">
                            <Btn variant="ghost" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Anterior</Btn>
                            <Btn variant="ghost" disabled={(page + 1) * MAX_BATCH >= totalCount} onClick={() => setPage(p => p + 1)}>Siguiente</Btn>
                        </div>
                    </div>
                )}
            </Page>

            {/* Modal Pre-vuelo */}
            {preflightOpen && (
                <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setPreflightOpen(false)}>
                    <div className="w-full max-w-5xl max-h-[90vh] bg-[var(--surface)] rounded-2xl border border-[var(--border)] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--text)]">
                                    Pre-vuelo de Replicación (Semáforo + GTIN Condicional + Precios)
                                </h3>
                                <p className="text-[11px] text-[var(--text-faint)]">
                                    Ningún ítem con bloqueador se encolará; errores individuales 400/422 en vivo quedarán aislados por fila.
                                </p>
                            </div>
                            <button type="button" onClick={() => setPreflightOpen(false)} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)]">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {preflightLoading || !preflightResult ? (
                                <div className="py-16 text-center text-sm text-[var(--text-faint)]">
                                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[var(--accent)]" />
                                    Evaluando duplicados en destino, GTIN condicional por marca y precios Motor V2…
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-center">
                                        <div className="p-2.5 rounded-xl bg-[var(--ok)]/10 border border-[var(--ok)]/30">
                                            <div className="text-lg font-bold text-[var(--ok)]">{preflightResult.summary.ready}</div>
                                            <div className="text-[10px] text-[var(--text-muted)]">Listas</div>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-[var(--warn)]/10 border border-[var(--warn)]/30">
                                            <div className="text-lg font-bold text-[var(--warn)]">{preflightResult.summary.with_warnings}</div>
                                            <div className="text-[10px] text-[var(--text-muted)]">Con avisos</div>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-[var(--err)]/10 border border-[var(--err)]/30">
                                            <div className="text-lg font-bold text-[var(--err)]">{preflightResult.summary.blocked}</div>
                                            <div className="text-[10px] text-[var(--text-muted)]">Bloqueadas</div>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-[var(--info)]/10 border border-[var(--info)]/30">
                                            <div className="text-lg font-bold text-[var(--info)]">{preflightResult.summary.with_catalog}</div>
                                            <div className="text-[10px] text-[var(--text-muted)]">Con Catálogo</div>
                                        </div>
                                        <div className="p-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                                            <div className="text-lg font-bold text-[var(--text)]">{preflightResult.summary.full_origin}</div>
                                            <div className="text-[10px] text-[var(--text-muted)]">Origen Full</div>
                                        </div>
                                    </div>

                                    <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)] border-b border-[var(--border)]">
                                                <tr>
                                                    <th className="px-3 py-2 w-8">Inc.</th>
                                                    <th className="px-3 py-2 text-[10px] uppercase">Producto</th>
                                                    <th className="px-3 py-2 text-[10px] uppercase">GTIN / Catálogo</th>
                                                    <th className="px-3 py-2 text-[10px] uppercase">Precio Destino</th>
                                                    <th className="px-3 py-2 text-[10px] uppercase">Diagnóstico Pre-vuelo</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-[var(--border)]">
                                                {preflightResult.items.map(it => {
                                                    const isBlocker = it.status === 'blocker';
                                                    const isChecked = preflightCheckedIds.has(it.publicacion_id);
                                                    return (
                                                        <tr key={it.publicacion_id} className={cn(isBlocker && 'bg-[var(--err)]/5')}>
                                                            <td className="px-3 py-2 align-top">
                                                                <input
                                                                    type="checkbox"
                                                                    disabled={isBlocker}
                                                                    checked={isChecked}
                                                                    onChange={e => {
                                                                        setPreflightCheckedIds(prev => {
                                                                            const next = new Set(prev);
                                                                            if (e.target.checked) next.add(it.publicacion_id);
                                                                            else next.delete(it.publicacion_id);
                                                                            return next;
                                                                        });
                                                                    }}
                                                                    className="w-4 h-4 rounded text-[var(--accent)]"
                                                                />
                                                            </td>
                                                            <td className="px-3 py-2 align-top max-w-xs">
                                                                <p className="font-mono text-[10px] text-[var(--text-faint)]">{it.external_item_id} · {it.brand || '—'}</p>
                                                                <p className="font-semibold text-[var(--text)] line-clamp-2">{it.titulo}</p>
                                                            </td>
                                                            <td className="px-3 py-2 align-top">
                                                                <p className="font-mono text-[10px]">
                                                                    {it.effective_gtin ? `GTIN: ${it.effective_gtin}` : 'Sin GTIN'}
                                                                </p>
                                                                {it.effective_catalog_product_id && (
                                                                    <p className="font-mono text-[10px] text-[var(--ok)]">Cat: {it.effective_catalog_product_id}</p>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-2 align-top">
                                                                <p className="font-bold text-[var(--text)]">{fmtMoney(it.target_price)}</p>
                                                                <p className="text-[10px] text-[var(--text-faint)]">{it.price_source}</p>
                                                            </td>
                                                            <td className="px-3 py-2 align-top space-y-1">
                                                                {it.status === 'ready' && (
                                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--ok)]">
                                                                        <CheckCircle2 className="w-3 h-3" /> Lista para replicar
                                                                    </span>
                                                                )}
                                                                {it.blockers.map((b, bi) => (
                                                                    <p key={bi} className="text-[10px] font-semibold text-[var(--err)] flex items-start gap-1">
                                                                        <ShieldAlert className="w-3 h-3 shrink-0 mt-0.5" /> {b}
                                                                    </p>
                                                                ))}
                                                                {it.warnings.map((w, wi) => (
                                                                    <p key={wi} className="text-[10px] text-[var(--warn)] flex items-start gap-1">
                                                                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" /> {w}
                                                                    </p>
                                                                ))}
                                                                {it.duplicate_level === 'exact' && !isBlocker && (
                                                                    <label className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[var(--text)] cursor-pointer">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={forceDupIds.has(it.publicacion_id)}
                                                                            onChange={e => {
                                                                                setForceDupIds(prev => {
                                                                                    const next = new Set(prev);
                                                                                    if (e.target.checked) next.add(it.publicacion_id);
                                                                                    else next.delete(it.publicacion_id);
                                                                                    return next;
                                                                                });
                                                                            }}
                                                                        />
                                                                        <span>Forzar copia (no solo vincular 409)</span>
                                                                    </label>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="px-5 py-3.5 border-t border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between gap-3">
                            <span className="text-xs text-[var(--text-muted)]">
                                Se encolarán <strong>{preflightCheckedIds.size}</strong> publicación(es) hacia la cuenta destino.
                            </span>
                            <div className="flex gap-2">
                                <Btn variant="ghost" onClick={() => setPreflightOpen(false)}>Cancelar</Btn>
                                <Btn
                                    onClick={confirmAndStartBatch}
                                    disabled={enqueuing || preflightLoading || preflightCheckedIds.size === 0}
                                    loading={enqueuing}
                                    icon={<Copy className="w-4 h-4" />}
                                >
                                    Confirmar y Copiar Lote ({preflightCheckedIds.size})
                                </Btn>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <BatchMonitorDrawer
                open={monitorOpen}
                onClose={() => setMonitorOpen(false)}
                activeBatchId={activeBatchId}
                onSelectBatchId={setActiveBatchId}
                accounts={accounts}
            />
        </div>
    );
}

export default function ReplicarPage() {
    return (
        <Suspense fallback={<div className="p-8 text-sm text-[var(--text-faint)]">Cargando replicador multi-cuenta…</div>}>
            <ReplicarContent />
        </Suspense>
    );
}
