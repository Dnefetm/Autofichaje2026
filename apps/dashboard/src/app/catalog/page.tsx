"use client";

import { useState, useEffect } from 'react';
import { Package, Search, Filter, TrendingUp, AlertCircle, RefreshCw, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dashboardService } from '@/lib/dashboard-service';
import { CatalogFilters } from './filters';
import { SkuCard } from './sku-card';
import { cn } from '@/lib/utils';

export default function CatalogPage() {
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [editingSku, setEditingSku] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');

    useEffect(() => {
        fetchProducts();
    }, []);

    // Removed MOCK_PRODUCTS to stop hiding real errors

    async function fetchProducts() {
        setLoading(true);
        setFetchError(null);
        try {
            const { data, error } = await supabase
                .from('skus')
                .select(`
                  sku, 
                  name, 
                  brand, 
                  inventory_snapshot(physical_stock),
                  sku_marketplace_mapping(marketplace_id, external_item_id)
                `)
                .limit(100);

            if (error) {
                console.error("Supabase Error:", error);
                setFetchError(error.message || JSON.stringify(error));
                setProducts([]);
            } else {
                setProducts(data || []);
            }
        } catch (err: any) {
            console.error('Network/Client Error:', err);
            setFetchError(err.message || 'Error catastrófico de red');
            setProducts([]);
        } finally {
            setLoading(false);
        }
    }

    const handleStockUpdate = (sku: string, newStock: number) => {
        setProducts(prev => prev.map(p =>
            p.sku === sku ? { ...p, inventory_snapshot: { physical_stock: newStock } } : p
        ));
    };

    const filteredProducts = products.filter(p => {
        const matchesSearch =
            p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (p.brand && p.brand.toLowerCase().includes(searchQuery.toLowerCase()));

        if (!matchesSearch) return false;

        const isMapped = p.sku_marketplace_mapping?.length > 0;
        const stock = p.inventory_snapshot?.physical_stock || 0;

        switch (filterStatus) {
            case 'mapped': return isMapped;
            case 'unmapped': return !isMapped;
            case 'low_stock': return stock <= 2;
            default: return true;
        }
    });

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Catálogo Maestro</h2>
                    <p className="text-slate-500">Conectado a Supabase Realtime.</p>
                </div>
                <button
                    onClick={fetchProducts}
                    className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                    title="Refrescar datos"
                >
                    <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
                </button>
            </div>

            {/* Grid de Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard label="Total SKUs" value={products.length.toString()} icon={<Package />} color="blue" />
                <StatCard label="En Sync" value={products.filter(p => p.sku_marketplace_mapping?.length > 0).length.toString()} icon={<TrendingUp />} color="green" />
                <StatCard label="Sin Mapeo" value={products.filter(p => !p.sku_marketplace_mapping?.length).length.toString()} icon={<AlertCircle />} color="amber" />
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
                <div className="py-20 text-center text-slate-400 flex flex-col items-center gap-4">
                    <RefreshCw className="w-8 h-8 animate-spin text-indigo-200" />
                    <p>Sincronizando catálogo maestro...</p>
                </div>
            ) : fetchError ? (
                <div className="py-20 text-center bg-rose-50 rounded-xl border border-rose-200 shadow-sm flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center">
                        <AlertCircle className="w-8 h-8 text-rose-500" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-rose-900">Error de Base de Datos</h3>
                        <p className="text-rose-500 max-w-lg mt-1 whitespace-pre-wrap">{fetchError}</p>
                    </div>
                </div>
            ) : filteredProducts.length === 0 ? (
                <div className="py-20 text-center bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col items-center gap-4">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                        <Package className="w-8 h-8 text-slate-300" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-900">No se encontraron productos</h3>
                        <p className="text-slate-500 max-w-sm mt-1">Intenta ajustar tus filtros de búsqueda. O revisa que la base de datos realmente tenga SKUs.</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredProducts.map((product) => (
                        <SkuCard
                            key={product.sku}
                            product={product}
                            onStockUpdate={handleStockUpdate}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function StatCard({ label, value, icon, color }: any) {
    const colors: any = {
        blue: 'bg-blue-50 text-blue-600',
        green: 'bg-green-50 text-green-600',
        amber: 'bg-amber-50 text-amber-600'
    };
    return (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className={cn("w-12 h-12 rounded-full flex items-center justify-center", colors[color])}>
                {icon}
            </div>
            <div>
                <p className="text-sm text-slate-500 font-medium">{label}</p>
                <p className="text-2xl font-bold">{value}</p>
            </div>
        </div>
    );
}
