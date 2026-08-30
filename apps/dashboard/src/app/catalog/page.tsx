"use client";

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Package, Search, Filter, TrendingUp, AlertCircle, RefreshCw, Save, CheckSquare, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dashboardService } from '@/lib/dashboard-service';
import { CatalogFilters } from './filters';
import { SkuCard } from './sku-card';
import { BulkEditModal } from './bulk-edit-modal';
import { cn } from '@/lib/utils';
import Link from 'next/link';

function CatalogPageInner() {
    const searchParams = useSearchParams();
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');
    const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('q') ?? '');
    const [filterStatus, setFilterStatus] = useState('all');

    // Paginación y Stats Globales
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [globalMappedCount, setGlobalMappedCount] = useState(0);
    const PAGE_SIZE = 48;

    // Mass Edit State
    const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
    const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);

    // Debounce de búsqueda (400ms)
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
            setPage(0);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        fetchProducts(page);
    }, [page, debouncedSearch, filterStatus]);

    useEffect(() => {
        fetchStats();
    }, []);

    // Removed MOCK_PRODUCTS to stop hiding real errors

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

    async function fetchProducts(currentPage: number) {
        setLoading(true);
        setFetchError(null);
        try {
            const from = currentPage * PAGE_SIZE;
            const to = from + PAGE_SIZE - 1;

            let query = supabase
                .from('articulos')
                .select(`
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
                `, { count: 'exact' })
                .order('creado_el', { ascending: false })
            .not('nombre', 'like', '%PLACEHOLDER%');

            // Búsqueda server-side
            if (debouncedSearch.length >= 2) {
                query = query.or(`nombre.ilike.%${debouncedSearch}%,marca.ilike.%${debouncedSearch}%,articulo_id.ilike.%${debouncedSearch}%,modelo.ilike.%${debouncedSearch}%,codigo_universal.ilike.%${debouncedSearch}%,variante.ilike.%${debouncedSearch}%`);
            }

                        // Filtro server-side por estado de mapeo
            if (filterStatus === 'mapped') {
                query = query.not('mapeo_publicacion_articulo', 'is', null);
            } else if (filterStatus === 'unmapped') {
                query = query.is('mapeo_publicacion_articulo', null);
            }

            const { data, error, count } = await query.range(from, to);

            if (error) {
                console.error("Supabase Error:", error);
                setFetchError(error.message || JSON.stringify(error));
                setProducts([]);
            } else {
                setProducts(data || []);
                setTotalCount(count || 0);
            }
        } catch (err: any) {
            console.error('Network/Client Error:', err);
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '¡LA VARIABLE NO ESTÁ DEFINIDA EN VERCEL!';
            setFetchError(`${err.message || 'Error catastrófico de red'}\nURL: ${supabaseUrl}`);
            setProducts([]);
        } finally {
            setLoading(false);
        }
    }

    const handleStockUpdate = (sku: string, newStock: number) => {
        setProducts(prev => prev.map(p =>
            p.articulo_id === sku ? { ...p, inventory_snapshot: { physical_stock: newStock } } : p
        ));
    };

    const handleToggleSelection = (sku: string) => {
        setSelectedSkus(prev => {
            const next = new Set(prev);
            if (next.has(sku)) {
                next.delete(sku);
            } else {
                next.add(sku);
            }
            return next;
        });
    };

    const handleSelectAllInPage = () => {
        if (selectedSkus.size === filteredProducts.length && filteredProducts.length > 0) {
            setSelectedSkus(new Set()); // deselect all
        } else {
            const allPageSkus = filteredProducts.map(p => p.articulo_id);
            setSelectedSkus(new Set(allPageSkus));
        }
    };

    // Filtrado client-side solo para estado (mapped/unmapped/low_stock)
    // La búsqueda de texto ya es server-side
    const filteredProducts = products.filter(p => {
        const isMapped = Array.isArray(p.mapeo_publicacion_articulo) ? p.mapeo_publicacion_articulo.length > 0 : !!p.mapeo_publicacion_articulo;

        const snapshot = Array.isArray(p.inventory_snapshot) ? p.inventory_snapshot[0] : p.inventory_snapshot;
        const stock = snapshot?.physical_stock || 0;

        switch (filterStatus) {
            case 'mapped': return true;
            case 'unmapped': return true;
            case 'low_stock': return stock <= 2;
            default: return true;
        }
    });

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight text-[var(--text)]">Catálogo Maestro</h2>
                    <p className="text-[var(--text-muted)] text-sm">Gestiona tu inventario y sincroniza con marketplaces.</p>
                </div>
                <div className="flex gap-3">
                    <Link
                        href="/catalog/bundles"
                        className="px-4 py-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--bg)] text-[var(--text-muted)] rounded-lg text-sm font-semibold flex items-center gap-2 transition-colors shadow-sm"
                    >
                        <Package className="w-4 h-4" />
                        Constructor de Kits
                    </Link>                   <button
                        onClick={() => { fetchProducts(page); fetchStats(); }}
                        className="p-2 text-[var(--text-faint)] hover:text-[var(--accent)] transition-colors"
                        title="Refrescar datos"
                    >
                        <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
                    </button>
                </div>
            </div>

            {/* Grid de Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard label="Total SKUs (Global)" value={totalCount.toString()} icon={<Package />} color="blue" />
                <StatCard label="Mapeos Activos" value={globalMappedCount.toString()} icon={<TrendingUp />} color="green" />
                <StatCard label="Mostrando en esta pág." value={products.length.toString()} icon={<Filter />} color="amber" />
            </div>

            {/* Búsqueda y Filtros */}
            <CatalogFilters
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                filterStatus={filterStatus}
                setFilterStatus={setFilterStatus}
            />

            {/* Grid de Productos o Errores */}
            {loading ? (
                <div className="py-20 text-center text-[var(--text-faint)] flex flex-col items-center gap-4">
                    <RefreshCw className="w-8 h-8 animate-spin text-indigo-200" />
                    <p>Sincronizando catálogo maestro...</p>
                </div>
            ) : fetchError ? (
                <div className="py-20 text-center bg-[var(--err)]/10 rounded-xl border border-[var(--err)]/30 shadow-sm flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center">
                        <AlertCircle className="w-8 h-8 text-[var(--err)]" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-rose-900">Error de Base de Datos</h3>
                        <p className="text-[var(--err)] max-w-lg mt-1 whitespace-pre-wrap">{fetchError}</p>
                    </div>
                </div>
            ) : filteredProducts.length === 0 ? (
                <div className="py-20 text-center bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-[var(--bg)] rounded-full flex items-center justify-center">
                        <Package className="w-8 h-8 text-slate-300" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text)]">No se encontraron productos</h3>
                        <p className="text-[var(--text-muted)] max-w-sm mt-1">Intenta ajustar tus filtros de búsqueda. O revisa que la base de datos realmente tenga SKUs.</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredProducts.map((product) => (
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
            {!loading && !fetchError && totalCount > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-6 border-t border-[var(--border)]">
                    <p className="text-sm text-[var(--text-muted)]">
                        Mostrando {page * PAGE_SIZE + 1} a {Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount} SKUs
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] bg-[var(--surface)] border border-slate-300 rounded-md hover:bg-[var(--bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Anterior
                        </button>
                        <button
                            onClick={() => setPage(p => p + 1)}
                            disabled={(page + 1) * PAGE_SIZE >= totalCount}
                            className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] bg-[var(--surface)] border border-slate-300 rounded-md hover:bg-[var(--bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Siguiente
                        </button>
                    </div>
                </div>
            )}

            {/* Floating Action Bar for Mass selection */}
            {selectedSkus.size > 0 && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-[var(--surface-2)] text-[var(--accent-ink)] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-6 z-40 animate-in slide-in-from-bottom-10 border border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[var(--accent)]/100/20 flex items-center justify-center text-indigo-300">
                            <CheckSquare className="w-4 h-4" />
                        </div>
                        <div>
                            <p className="text-sm font-bold">{selectedSkus.size} Seleccionados</p>
                            <button
                                onClick={handleSelectAllInPage}
                                className="text-xs text-[var(--text-faint)] hover:text-[var(--accent-ink)] transition-colors"
                            >
                                {selectedSkus.size === filteredProducts.length ? 'Deseleccionar todos' : 'Seleccionar página actual'}
                            </button>
                        </div>
                    </div>

                    <div className="w-px h-8 bg-slate-700"></div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsBulkModalOpen(true)}
                            className="bg-[var(--accent)] hover:bg-[var(--accent)]/100 text-[var(--accent-ink)] text-sm font-bold px-5 py-2 rounded-xl transition-colors shadow-lg shadow-indigo-500/20"
                        >
                            Modificar Precios
                        </button>
                        <button
                            onClick={() => setSelectedSkus(new Set())}
                            className="p-2 text-[var(--text-faint)] hover:text-[var(--accent-ink)] rounded-lg hover:bg-[var(--surface)] transition-colors"
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
                    setSelectedSkus(new Set()); // clean up
                    alert('Lote de actualización enviado al Worker correctamente.');
                }}
            />
        </div>
    );
}

export default function CatalogPage() {
    return (
        <Suspense fallback={
            <div className="py-20 text-center text-[var(--text-faint)]">Cargando catálogo...</div>
        }>
            <CatalogPageInner />
        </Suspense>
    );
}

function StatCard({ label, value, icon, color }: any) {
    const colors: any = {
        blue: 'bg-blue-50 text-blue-600',
        green: 'bg-green-50 text-green-600',
        amber: 'bg-[var(--warn)]/10 text-[var(--warn)]'
    };
    return (
        <div className="bg-[var(--surface)] p-4 rounded-xl border border-[var(--border)] shadow-sm flex items-center gap-4">
            <div className={cn("w-12 h-12 rounded-full flex items-center justify-center", colors[color])}>
                {icon}
            </div>
            <div>
                <p className="text-sm text-[var(--text-muted)] font-medium">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
            </div>
        </div>
    );
}
