"use client";

import React, { useState, useEffect } from 'react';
import { Package, Search, Plus, Trash2, ArrowLeft, Save, Loader2, Link as LinkIcon, X } from 'lucide-react';
import { dashboardService } from '@/lib/dashboard-service';
import Link from 'next/link';

export default function BundlesPage() {
    const [bundleSku, setBundleSku] = useState("");
    const [components, setComponents] = useState<Array<{ sku: string, name: string, quantity: number, image?: string }>>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [statusMessage, setStatusMessage] = useState({ text: "", type: "" });

    // Cargar bundle existente si se tipea el SKU exacto
    useEffect(() => {
        if (bundleSku.length > 3) {
            const loadExisting = async () => {
                try {
                    const data = await dashboardService.getBundleComponents(bundleSku);
                    if (data && data.length > 0) {
                        setComponents(data.map((c: any) => ({
                            sku: c.component_sku,
                            name: c.skus?.name || 'Producto Desconocido',
                            quantity: c.quantity,
                            image: c.skus?.images?.[0]
                        })));
                    } else {
                        // Si era un bundle y lo borraron, no limpiamos inmediatamente para permitir edición
                    }
                } catch (err) {
                    console.error("Error cargando bundle:", err);
                }
            };
            const debounce = setTimeout(loadExisting, 800);
            return () => clearTimeout(debounce);
        }
    }, [bundleSku]);

    // Buscar SKUs
    useEffect(() => {
        if (!searchQuery) {
            setSearchResults([]);
            return;
        }

        const doSearch = async () => {
            setIsSearching(true);
            try {
                const results = await dashboardService.searchSKUs(searchQuery);
                setSearchResults(results || []);
            } catch (err) {
                console.error("Error buscando SKUs:", err);
            } finally {
                setIsSearching(false);
            }
        };

        const debounce = setTimeout(doSearch, 300);
        return () => clearTimeout(debounce);
    }, [searchQuery]);

    const addComponent = (skuData: any) => {
        if (components.find(c => c.sku === skuData.sku)) return; // Ya existe

        setComponents([...components, {
            sku: skuData.sku,
            name: skuData.name,
            quantity: 1,
            image: skuData.images?.[0]
        }]);
        setSearchQuery("");
        setSearchResults([]);
    };

    const removeComponent = (skuToRemove: string) => {
        setComponents(components.filter(c => c.sku !== skuToRemove));
    };

    const updateQuantity = (sku: string, newQuantity: number) => {
        if (newQuantity < 1) return;
        setComponents(components.map(c => c.sku === sku ? { ...c, quantity: newQuantity } : c));
    };

    const handleSave = async () => {
        if (!bundleSku) {
            setStatusMessage({ text: "Debes ingresar un SKU para el Kit.", type: "error" });
            return;
        }
        if (components.length === 0) {
            setStatusMessage({ text: "El Kit debe tener al menos un componente.", type: "error" });
            return;
        }

        setIsSaving(true);
        setStatusMessage({ text: "", type: "" });
        try {
            await dashboardService.saveBundle(
                bundleSku,
                components.map(c => ({ component_sku: c.sku, quantity: c.quantity }))
            );
            setStatusMessage({ text: "Kit guardado y re-calculado con éxito.", type: "success" });
        } catch (err: any) {
            setStatusMessage({ text: "Error al guardar: " + err.message, type: "error" });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2 mb-2">
                        <Link href="/catalog" className="text-slate-500 hover:text-indigo-600 transition-colors">
                            Catálogo
                        </Link>
                        <span className="text-slate-300">/</span>
                        <span className="font-medium text-slate-700">Kits y Combos</span>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Package className="w-6 h-6 text-indigo-600" />
                        Constructor de Kits (Bundles)
                    </h2>
                    <p className="text-slate-500 text-sm mt-1">Arma publicaciones dinámicas basadas en stock de componentes.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Panel Izquierdo: Definición del Kit */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
                    <div className="p-4 border-b border-slate-100 bg-slate-50">
                        <h3 className="font-bold text-slate-800">Definir Kit</h3>
                    </div>

                    <div className="p-4 flex-1 overflow-y-auto space-y-6">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700">SKU del Kit Master</label>
                            <input
                                type="text"
                                value={bundleSku}
                                onChange={(e) => setBundleSku(e.target.value.trim().toUpperCase())}
                                placeholder="Ej: KIT-OFERTA-01"
                                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 uppercase"
                            />
                            <p className="text-xs text-slate-500">Este es el SKU que se sincronizará con Mercado Libre.</p>
                        </div>

                        <div className="border-t border-slate-100 pt-4">
                            <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center justify-between">
                                Componentes del Kit
                                <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs">
                                    {components.length} ítems
                                </span>
                            </h4>

                            {components.length === 0 ? (
                                <div className="text-center py-8 text-slate-400 border-2 border-dashed border-slate-100 rounded-lg">
                                    <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                                    <p className="text-sm">No hay piezas agregadas.</p>
                                    <p className="text-xs mt-1">Busca y agrega productos desde el panel derecho.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {components.map(comp => (
                                        <div key={comp.sku} className="flex grid-cols-12 gap-3 items-center p-3 border rounded-lg bg-slate-50 relative group">
                                            {comp.image ? (
                                                <img src={comp.image} alt={comp.name} className="w-12 h-12 rounded object-cover border" />
                                            ) : (
                                                <div className="w-12 h-12 rounded bg-slate-200 border flex items-center justify-center">
                                                    <Package className="w-5 h-5 text-slate-400" />
                                                </div>
                                            )}

                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-bold text-slate-900 truncate">{comp.name}</p>
                                                <p className="text-xs text-slate-500 font-mono">{comp.sku}</p>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <span className="text-xs text-slate-500 font-medium">Cant:</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={comp.quantity}
                                                    onChange={(e) => updateQuantity(comp.sku, parseInt(e.target.value) || 1)}
                                                    className="w-16 px-2 py-1 text-sm border rounded text-center font-bold"
                                                />
                                            </div>

                                            <button
                                                onClick={() => removeComponent(comp.sku)}
                                                className="absolute -top-2 -right-2 bg-red-100 text-red-600 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-200"
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-3">
                        {statusMessage.text && (
                            <div className={`text-xs p-2 rounded ${statusMessage.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                                {statusMessage.text}
                            </div>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={isSaving || components.length === 0 || !bundleSku}
                            className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                            Guardar y Sincronizar Kit
                        </button>
                    </div>
                </div>

                {/* Panel Derecho: Buscador de Piezas */}
                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[600px]">
                    <div className="p-4 border-b border-slate-100 flex gap-3 bg-slate-50 relative">
                        <Search className="w-5 h-5 text-slate-400 absolute left-7 top-7" />
                        <input
                            type="text"
                            placeholder="Buscar productos por SKU o Nombre para agregar..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm shadow-sm"
                        />
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 bg-slate-50/50">
                        {isSearching ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                            </div>
                        ) : searchResults.length > 0 ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2">
                                {searchResults.map((result) => (
                                    <div key={result.sku} className="flex gap-3 p-3 bg-white border border-slate-200 rounded-lg hover:border-indigo-300 transition-colors items-center group">
                                        {result.images?.[0] ? (
                                            <img src={result.images[0]} alt="" className="w-12 h-12 rounded bg-slate-100 object-cover" />
                                        ) : (
                                            <div className="w-12 h-12 rounded bg-slate-100 flex items-center justify-center">
                                                <Package className="w-5 h-5 text-slate-300" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-800 truncate" title={result.name}>{result.name}</p>
                                            <p className="text-xs text-slate-500 font-mono">{result.sku}</p>
                                        </div>
                                        <button
                                            onClick={() => addComponent(result)}
                                            className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-colors"
                                            title="Agregar al Kit"
                                        >
                                            <Plus className="w-5 h-5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : searchQuery ? (
                            <div className="text-center py-12 text-slate-400">
                                <p>No se encontraron productos.</p>
                            </div>
                        ) : (
                            <div className="text-center py-20 text-slate-400">
                                <LinkIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                <p className="text-sm font-medium">Busca piezas en tu catálogo para crear un combo.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
