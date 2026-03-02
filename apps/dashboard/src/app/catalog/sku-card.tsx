import React, { useState } from 'react';
import { Package, TrendingUp, AlertCircle, Save, Edit2, Image as ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dashboardService } from '@/lib/dashboard-service';

export function SkuCard({ product, onStockUpdate }: { product: any, onStockUpdate: (sku: string, newStock: number) => void }) {
    const [editing, setEditing] = useState(false);

    // Safety check arrays vs objects for inventory
    const snapshot = Array.isArray(product.inventory_snapshot) ? product.inventory_snapshot[0] : product.inventory_snapshot;
    const [newStock, setNewStock] = useState<number>(snapshot?.physical_stock || 0);

    const [saving, setSaving] = useState(false);

    // MOCK Images if not available (assuming Supabase will give us images array later)
    const image = product.images?.[0] || null;

    const isMapped = Array.isArray(product.sku_marketplace_mapping) ? product.sku_marketplace_mapping.length > 0 : !!product.sku_marketplace_mapping;
    const isLowStock = newStock <= 2;

    const handleSave = async () => {
        setSaving(true);
        try {
            await dashboardService.triggerStockUpdate(product.sku, newStock, 'meli_account_1');
            onStockUpdate(product.sku, newStock);
            setEditing(false);
        } catch (err) {
            alert('Error al intentar actualizar el stock');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col group hover:shadow-md transition-shadow">
            {/* Image Section */}
            <div className="aspect-square bg-slate-100 flex items-center justify-center relative overflow-hidden">
                {image ? (
                    <img src={image} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                    <div className="flex flex-col items-center justify-center text-slate-400 gap-2">
                        <ImageIcon className="w-8 h-8 opacity-50" />
                        <span className="text-xs font-medium">Sin Imagen</span>
                    </div>
                )}

                {/* Badges Overlay */}
                <div className="absolute top-3 left-3 flex flex-col gap-2">
                    {isMapped ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold bg-yellow-400 text-yellow-900 shadow-sm">
                            Mercado Libre
                        </span>
                    ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold bg-slate-800 text-white shadow-sm">
                            Desvinculado
                        </span>
                    )}
                </div>
            </div>

            {/* Content Section */}
            <div className="p-5 flex-1 flex flex-col">
                <div className="mb-1">
                    <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">{product.brand || 'GENERIC'}</span>
                </div>
                <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2 mb-4 flex-1">
                    {product.name}
                </h3>

                <div className="grid grid-cols-2 gap-4 items-end mt-auto pt-4 border-t border-slate-100">
                    <div>
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">SKU</p>
                        <p className="text-xs font-mono font-semibold text-slate-700 bg-slate-100 px-2 py-1 rounded w-fit">
                            {product.sku}
                        </p>
                    </div>

                    <div className="text-right flex flex-col items-end">
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Stock Físico</p>
                        {editing ? (
                            <div className="flex items-center gap-1">
                                <input
                                    type="number"
                                    value={newStock}
                                    onChange={(e) => setNewStock(parseInt(e.target.value) || 0)}
                                    className="w-16 px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-center"
                                    autoFocus
                                />
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="p-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    <Save className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 group/edit cursor-pointer" onClick={() => setEditing(true)}>
                                <span className={cn(
                                    "text-xl font-black",
                                    isLowStock ? "text-rose-600" : "text-emerald-600"
                                )}>
                                    {newStock}
                                </span>
                                <Edit2 className="w-3 h-3 text-slate-300 group-hover/edit:text-indigo-600 transition-colors" />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Sync Action */}
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <button className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 transition-colors">
                    Ver Ficha Técnica
                </button>
                {isMapped && (
                    <button className="text-xs font-bold text-slate-500 hover:text-emerald-600 flex items-center gap-1.5 transition-colors">
                        <TrendingUp className="w-3 h-3" />
                        Forzar Sync
                    </button>
                )}
            </div>
        </div>
    );
}
