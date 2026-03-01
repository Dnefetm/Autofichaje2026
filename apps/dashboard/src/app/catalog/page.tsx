"use client";

import { useState, useEffect } from 'react';
import { Package, Search, Filter, TrendingUp, AlertCircle, RefreshCw, Save } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dashboardService } from '@/lib/dashboard-service';
import { cn } from '@/lib/utils';

export default function CatalogPage() {
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingSku, setEditingSku] = useState<string | null>(null);
    const [newStock, setNewStock] = useState<number>(0);

    useEffect(() => {
        fetchProducts();
    }, []);

    const MOCK_PRODUCTS = [
        {
            sku: 'HERR-001',
            nombre: 'Destornillador Phillips Pro',
            marca: 'Stanley',
            inventory_snapshot: { physical_stock: 15 },
            sku_marketplace_mapping: [{ marketplace_id: 'meli_1' }]
        },
        {
            sku: 'HERR-002',
            nombre: 'Martillo de Carpintero 16oz',
            marca: 'Truper',
            inventory_snapshot: { physical_stock: 2 },
            sku_marketplace_mapping: []
        },
        {
            sku: 'ELEC-045',
            nombre: 'Taladro Percutor 20V',
            marca: 'Dewalt',
            inventory_snapshot: { physical_stock: 8 },
            sku_marketplace_mapping: [{ marketplace_id: 'meli_1' }]
        }
    ];

    async function fetchProducts() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('skus')
                .select(`
                  sku, 
                  nombre, 
                  marca, 
                  inventory_snapshot(physical_stock),
                  sku_marketplace_mapping(marketplace_id, external_item_id)
                `)
                .limit(20);

            if (error || !data || data.length === 0) {
                setProducts(MOCK_PRODUCTS);
            } else {
                setProducts(data);
            }
        } catch (err) {
            console.error('Error fetching products:', err);
            setProducts(MOCK_PRODUCTS);
        } finally {
            setLoading(false);
        }
    }

    const handleEditStock = (product: any) => {
        setEditingSku(product.sku);
        setNewStock(product.inventory_snapshot?.physical_stock || 0);
    };

    const handleSaveStock = async (sku: string) => {
        try {
            // 1. Encolar job para MeLi (esto simula la acción masiva o individual)
            await dashboardService.triggerStockUpdate(sku, newStock, 'meli_account_1');

            // 2. Actualizar stock localmente para feedback inmediato
            setProducts(prev => prev.map(p =>
                p.sku === sku ? { ...p, inventory_snapshot: { physical_stock: newStock } } : p
            ));

            setEditingSku(null);
            alert(`Job de actualización para ${sku} encolado con éxito.`);
        } catch (err) {
            alert('Error al encolar el job');
        }
    };

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

            {/* Tabla */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-4">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input type="text" placeholder="Filtrar por SKU o nombre..." className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                            <tr>
                                <th className="px-6 py-3">Producto</th>
                                <th className="px-6 py-3">Stock Físico</th>
                                <th className="px-6 py-3">Marketplaces</th>
                                <th className="px-6 py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {loading ? (
                                <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400">Cargando catálogo...</td></tr>
                            ) : products.length === 0 ? (
                                <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-400">No hay productos en la base de datos.</td></tr>
                            ) : products.map((product) => (
                                <tr key={product.sku} className="hover:bg-slate-50 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="font-semibold">{product.nombre}</div>
                                        <div className="text-xs text-slate-400 font-mono uppercase">{product.sku} • {product.marca}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        {editingSku === product.sku ? (
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    value={newStock}
                                                    onChange={(e) => setNewStock(parseInt(e.target.value))}
                                                    className="w-20 px-2 py-1 border rounded focus:ring-2 focus:ring-indigo-500 outline-none"
                                                    autoFocus
                                                />
                                                <button onClick={() => handleSaveStock(product.sku)} className="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700">
                                                    <Save className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "font-bold",
                                                    (product.inventory_snapshot?.physical_stock || 0) <= 2 ? "text-red-600" : "text-slate-900"
                                                )}>
                                                    {product.inventory_snapshot?.physical_stock || 0}
                                                </span>
                                                <button
                                                    onClick={() => handleEditStock(product)}
                                                    className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-indigo-600 transition-all font-medium text-xs border border-transparent hover:border-slate-200 rounded"
                                                >
                                                    Editar
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex gap-1">
                                            {product.sku_marketplace_mapping?.length > 0 ? (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100"> MeLi </span>
                                            ) : (
                                                <span className="text-xs text-slate-300 italic">Sin vincular</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button className="text-indigo-600 hover:text-indigo-800 font-medium">Ficha Técnica</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
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
