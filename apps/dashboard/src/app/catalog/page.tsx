"use client";
import { toast } from 'sonner';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Package, Filter, TrendingUp, AlertCircle, RefreshCw, CheckSquare, X } from 'lucide-react';
import useSWR from 'swr';
import { supabase } from '@/lib/supabase';
import { CatalogFilters } from './filters';
import { SkuCard } from './sku-card';
import { BulkEditModal } from './bulk-edit-modal';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const PAGE_SIZE = 48;
const FILTERS_STORAGE_KEY = 'catalog.filters';

type Estado = 'all' | 'mapped' | 'unmapped' | 'low_stock';

/**
 * Fetcher server-side del catálogo (fuera del componente: puro y cacheable por SWR).
 * Usa count 'estimated' (rápido, sin escanear toda la tabla) en lugar de 'exact'.
 */
async function fetchCatalogPage([, q, estado, page]: [string, string, string, number]) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
        .from('articulos')
        .select(
            `
              articulo_id,
              nombre,
              marca,
              modelo,
              variante,
              categoria,
              codigo_universal,
              caja_madre,
              imagenes,
              inventory_snapshot(physical_stock),
              mapeo_publicacion_articulo(publicacion_id),
              fichas_tecnicas(id, estado, created_at)
            `,
            { count: 'estimated' }
        )
        .order('creado_el', { ascending: false })
        .not('nombre', 'like', '%PLACEHOLDER%');

    // Búsqueda server-side
    if (q.length >= 2) {
        query = query.or(
            `nombre.ilike.%${q}%,marca.ilike.%${q}%,articulo_id.ilike.%${q}%,modelo.ilike.%${q}%,codigo_universal.ilike.%${q}%,variante.ilike.%${q}%`
        );
    }

    // Filtro server-side por estado de mapeo (low_stock se resuelve en cliente)
    if (estado === 'mapped') {
        query = query.not('mapeo_publicacion_articulo', 'is', null);
    } else if (estado === 'unmapped') {
        query = query.is('mapeo_publicacion_articulo', null);
    }

    const { data, error, count } = await query.range(from, to);
    if (error) throw new Error(error.message);

    return { products: data || [], total: count ?? 0 };
}

function CatalogPageInner() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    // URL = única fuente de verdad de los filtros
    const q = searchParams.get('q') ?? '';
    const estado = (searchParams.get('estado') ?? 'all') as Estado;
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10) || 0);

    // Input en vivo (solo para el texto); se "commitea" a la URL con debounce
    const [searchInput, setSearchInput] = useState(q);
    const [globalMappedCount, setGlobalMappedCount] = useState(0);

    // Mass Edit State
    const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);

    // Cache SWR: muestra datos anteriores al instante y revalida en background.
    const { data, error, isLoading, isValidating, mutate } = useSWR(
        ['catalog', q, estado, page],
        fetchCatalogPage,
        { keepPreviousData: true, revalidateOnFocus: false, revalidateOnReconnect: false }
    );

    const products = data?.products ?? [];
    const totalCount = data?.total ?? 0;

    // Mantener el input sincronizado con la URL (cubre botón atrás/adelante y restauración)
    useEffect(() => {
        setSearchInput(q);
    }, [q]);

    // Restaurar últimos filtros (localStorage) la primera vez que se llega sin parámetros
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        const hasParams = searchParams.get('q') || searchParams.get('estado') || searchParams.get('page');
        if (!hasParams) {
            const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
            if (saved) router.replace(`/catalog?${saved}`, { scroll: false });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function commitParams(params: URLSearchParams) {
        const qs = params.toString();
        if (qs) localStorage.setItem(FILTERS_STORAGE_KEY, qs);
        else localStorage.removeItem(FILTERS_STORAGE_KEY);
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }

    // Debounce del texto (250ms) → URL. Solo commitea cuando el término efectivo cambia.
    useEffect(() => {
        const raw = searchInput.trim();
        const target = raw.length >= 2 ? raw : '';
        if (target === q) return;
        const timer = setTimeout(() => {
            const params = new URLSearchParams(searchParams.toString());
            if (target) params.set('q', target);
            else params.delete('q');
            params.delete('page'); // nueva búsqueda → volver a página 0
            commitParams(params);
        }, 250);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchInput]);

    function setEstado(v: string) {
        const params = new URLSearchParams(searchParams.toString());
        if (v === 'all') params.delete('estado');
        else params.set('estado', v);
        params.delete('page');
        commitParams(params);
    }

    function setPage(n: number) {
        const params = new URLSearchParams(searchParams.toString());
        if (n > 0) params.set('page', String(n));
        else params.delete('page');
        commitParams(params);
    }

    useEffect(() => {
        fetchStats();
    }, []);

    async function fetchStats() {
        try {
            const { count: mappedCount } = await supabase
                .from('mapeo_publicacion_articulo')
                .select('*', { count: 'exact', head: true });
            setGlobalMappedCount(mappedCount || 0);
        } catch (err) {
            console.error('Error fetching stats:', err);
        }
    }

    const handleStockUpdate = (sku: string, newStock: number) => {
        // Actualización optimista del caché SWR (sin re-fetch ni parpadeo)
        mutate(
            (current: any) => ({
                ...current,
                products: (current?.products ?? []).map((p: any) =>
                    p.articulo_id === sku
                        ? { ...p, inventory_snapshot: { physical_stock: newStock } }
                        : p
                ),
            }),
            { revalidate: false }
        );
    };

    const handleToggleSelection = (sku: string) => {
        setSelectedSkus((prev) => {
            const next = new Set(prev);
            if (next.has(sku)) next.delete(sku);
            else next.add(sku);
            return next;
        });
    };

    const handleSelectAllInPage = () => {
        if (selectedSkus.size === filteredProducts.length && filteredProducts.length > 0) {
            setSelectedSkus(new Set());
        } else {
            const allPageSkus = filteredProducts.map((p: any) => p.articulo_id);
            setSelectedSkus(new Set(allPageSkus));
        }
    };

    // Filtrado client-side solo para low_stock (mapped/unmapped ya vienen del servidor)
    const filteredProducts = products.filter((p: any) => {
        const snapshot = Array.isArray(p.inventory_snapshot) ? p.inventory_snapshot[0] : p.inventory_snapshot;
        const stock = snapshot?.physical_stock || 0;
        return estado === 'low_stock' ? stock <= 2 : true;
    });

    const fetchError = error ? (error.message || String(error)) : null;

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-[var(--text)]">Catálogo Maestro</h2>
                    <p className="text-[var(--text-muted)] text-sm">Gestiona tu inventario y sincroniza con marketplaces.</p>
                </div>
                <div className="flex gap-3 items-center">
                    <Link
                        href="/catalog/bundles"
                        className="px-4 py-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text-muted)] rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm"
                    >
                        <Package className="w-4 h-4" />
                        Constructor de Kits
                    </Link>
                    <button
                        onClick={() => { mutate(); fetchStats(); }}
                        className="p-2 text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
                        title="Refrescar datos"
                    >
                        <RefreshCw className={cn('w-5 h-5', isValidating && 'animate-spin')} />
                    </button>
                </div>
            </div>

            {/* Grid de Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard label="Total SKUs (≈)" value={totalCount.toString()} icon={<Package />} color="blue" />
                <StatCard label="Mapeos Activos" value={globalMappedCount.toString()} icon={<TrendingUp />} color="green" />
                <StatCard label="Mostrando en esta pág." value={products.length.toString()} icon={<Filter />} color="amber" />
            </div>

            {/* Búsqueda y Filtros */}
            <CatalogFilters
                searchQuery={searchInput}
                setSearchQuery={setSearchInput}
                filterStatus={estado}
                setFilterStatus={setEstado}
            />

            {/* Indicador sutil de actualización en background (no blanquea la grilla) */}
            {isValidating && !isLoading && (
                <div className="flex items-center gap-2 text-xs text-[var(--text-faint)]">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Actualizando…
                </div>
            )}

            {/* Grid de Productos o Errores */}
            {isLoading && !data ? (
                <div className="py-20 text-center text-[var(--text-faint)] flex flex-col items-center gap-4">
                    <RefreshCw className="w-8 h-8 animate-spin text-[var(--accent)]" />
                    <p>Sincronizando catálogo maestro...</p>
                </div>
            ) : fetchError && !data ? (
                <div className="py-20 text-center bg-[var(--err)]/10 rounded-xl border border-[var(--err)]/30 shadow-sm flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-[var(--err)]/10 rounded-full flex items-center justify-center">
                        <AlertCircle className="w-8 h-8 text-[var(--err)]" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-[var(--err)]">Error de Base de Datos</h3>
                        <p className="text-[var(--err)] max-w-lg mt-1 whitespace-pre-wrap">{fetchError}</p>
                    </div>
                </div>
            ) : filteredProducts.length === 0 ? (
                <div className="py-20 text-center bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-[var(--bg)] rounded-full flex items-center justify-center">
                        <Package className="w-8 h-8 text-[var(--text-faint)]" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text)]">No se encontraron productos</h3>
                        <p className="text-[var(--text-muted)] max-w-sm mt-1">Intenta ajustar tus filtros de búsqueda.</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredProducts.map((product: any) => (
                        <SkuCard
                            key={product.articulo_id}
                            product={product}
                            onStockUpdate={handleStockUpdate}
                            isSelected={selectedSkus.has(product.articulo_id)}
                            onToggleSelection={handleToggleSelection}
                        />
                    ))}
                </div>
            )}

            {/* Pagination Controls */}
            {!isLoading && !fetchError && totalCount > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-6 border-t border-[var(--border)]">
                    <p className="text-sm text-[var(--text-muted)]">
                        Mostrando {page * PAGE_SIZE + 1} a {Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount} SKUs
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(Math.max(0, page - 1))}
                            disabled={page === 0}
                            className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)] rounded-md hover:bg-[var(--bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Anterior
                        </button>
                        <button
                            onClick={() => setPage(page + 1)}
                            disabled={(page + 1) * PAGE_SIZE >= totalCount}
                            className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)] rounded-md hover:bg-[var(--bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Siguiente
                        </button>
                    </div>
                </div>
            )}

            {/* Floating Action Bar for Mass selection */}
            {selectedSkus.size > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[var(--surface-2)] text-[var(--accent-ink)] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-6 z-40 animate-in slide-in-from-bottom-10 border border-[var(--border)]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-[var(--accent)]">
                            <CheckSquare className="w-4 h-4" />
                        </div>
                        <div>
                            <p className="text-sm font-bold">{selectedSkus.size} Seleccionados</p>
                            <button
                                onClick={handleSelectAllInPage}
                                className="text-xs text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
                            >
                                {selectedSkus.size === filteredProducts.length ? 'Deseleccionar todos' : 'Seleccionar página actual'}
                            </button>
                        </div>
                    </div>

                    <div className="w-px h-8 bg-[var(--border)]"></div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsBulkModalOpen(true)}
                            className="bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] text-sm font-bold px-5 py-2 rounded-xl transition-colors shadow-lg"
                        >
                            Modificar Precios
                        </button>
                        <button
                            onClick={() => setSelectedSkus(new Set())}
                            className="p-2 text-[var(--text-faint)] hover:text-[var(--accent)] rounded-lg hover:bg-[var(--surface)] transition-colors"
                            title="Cancelar selección"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            )}

            <BulkEditModal
                isOpen={isBulkModalOpen}
                onClose={() => setIsBulkModalOpen(false)}
                selectedSkus={selectedSkus}
                onSuccess={() => {
                    setSelectedSkus(new Set());
                    toast.success('Lote de actualización enviado al Worker correctamente.');
                }}
            />
        </div>
    );
}

export default function CatalogPage() {
    return (
        <Suspense
            fallback={
                <div className="py-20 text-center text-[var(--text-faint)]">Cargando catálogo...</div>
            }
        >
            <CatalogPageInner />
        </Suspense>
    );
}

function StatCard({ label, value, icon, color }: any) {
    const colors: any = {
        blue: 'bg-[var(--info)]/10 text-[var(--info)]',
        green: 'bg-[var(--ok)]/10 text-[var(--ok)]',
        amber: 'bg-[var(--warn)]/10 text-[var(--warn)]',
    };
    return (
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--border)] shadow-sm flex items-center gap-4">
            <div className={cn('w-12 h-12 rounded-full flex items-center justify-center', colors[color])}>
                {icon}
            </div>
            <div>
                <p className="text-sm text-[var(--text-muted)] font-medium">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
            </div>
        </div>
    );
}
