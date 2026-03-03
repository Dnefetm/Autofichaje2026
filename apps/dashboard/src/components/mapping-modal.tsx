"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@gestor/shared/lib/supabase';
import { X, Search, Plus, Trash2, Package } from 'lucide-react';

interface MappingModalProps {
    listing: any;
    onClose: () => void;
    onSuccess: () => void;
}

export default function MappingModal({ listing, onClose, onSuccess }: MappingModalProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [selectedSkus, setSelectedSkus] = useState<any[]>([]); // { sku, name, quantity, mapping_id }
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (listing) {
            loadExistingMappings();
        }
    }, [listing]);

    async function loadExistingMappings() {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('mapeo_publicacion_articulo')
                .select(`
                    id,
                    cantidad_requerida,
                    sku_articulo,
                    articulos (nombre, sku)
                `)
                .eq('publicacion_id', listing.id);

            if (error) throw error;

            if (data) {
                const mapped = data.map((d: any) => ({
                    mapping_id: d.id,
                    sku: d.sku_articulo,
                    name: d.articulos?.nombre || 'Producto Desconocido',
                    quantity: d.cantidad_requerida
                }));
                setSelectedSkus(mapped);
            }
        } catch (error) {
            console.error('Error cargando mapeos previos:', error);
        } finally {
            setLoading(false);
        }
    }

    // Buscador en vivo de SKUs físicos
    useEffect(() => {
        const debounce = setTimeout(() => {
            if (searchTerm.length >= 2) {
                searchPhysicalCatalog();
            } else {
                setSearchResults([]);
            }
        }, 300);
        return () => clearTimeout(debounce);
    }, [searchTerm]);

    async function searchPhysicalCatalog() {
        try {
            const { data, error } = await supabase
                .from('articulos')
                .select('sku, nombre')
                .or(`sku.ilike.%${searchTerm}%,nombre.ilike.%${searchTerm}%`)
                .limit(10);

            if (error) throw error;
            setSearchResults(data || []);
        } catch (error) {
            console.error('Error buscando artículos físicos:', error);
        }
    }

    function handleAddSku(product: any) {
        if (selectedSkus.find(s => s.sku === product.sku)) return; // Ya existe
        setSelectedSkus([...selectedSkus, { sku: product.sku, name: product.nombre, quantity: 1, mapping_id: null }]);
        setSearchTerm(''); // Limpiar buscador
    }

    function handleRemoveSku(sku: string) {
        setSelectedSkus(selectedSkus.filter(s => s.sku !== sku));
    }

    function handleQuantityChange(sku: string, qty: number) {
        if (qty < 1) return;
        setSelectedSkus(selectedSkus.map(s => s.sku === sku ? { ...s, quantity: qty } : s));
    }

    async function handleSave() {
        if (selectedSkus.length === 0) {
            alert('Debes seleccionar al menos un artículo del catálogo real.');
            return;
        }

        setSaving(true);
        try {
            // 1. Borrar mapeos anteriores para esta publicación (limpieza cruda por simplicidad)
            const { error: delError } = await supabase
                .from('mapeo_publicacion_articulo')
                .delete()
                .eq('publicacion_id', listing.id);

            if (delError) throw delError;

            // 2. Insertar nuevos mapeos (El armado del Kit o Sencillo)
            const inserts = selectedSkus.map(s => ({
                publicacion_id: listing.id,
                sku_articulo: s.sku,
                cantidad_requerida: s.quantity
            }));

            const { error: insError } = await supabase
                .from('mapeo_publicacion_articulo')
                .insert(inserts);

            if (insError) throw insError;

            // 3. Crear orden de trabajo urgente para que el Worker calcule el stock en base a este ensamble y lo suba a MeLi ya mismo.
            const { error: jobError } = await supabase.from('jobs').insert({
                type: 'sync_stock_mapped',
                payload: {
                    publicacion_id: listing.id
                },
                status: 'pending',
                scheduled_at: new Date().toISOString()
            });

            if (jobError) console.error('Aviso: Mapeo guardado pero no se pudo encolar el Job automático para el worker.', jobError);

            onSuccess();
            onClose();
        } catch (error) {
            console.error('Error guardando el mapeo:', error);
            alert('Ocurrió un error al guardar el mapeo.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Mapear a Bodega Física</h2>
                        <p className="text-sm text-slate-500 mt-1">Vincula esta vitrina con 1 o más productos reales.</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                    {/* Tarjeta de Publicación Origen */}
                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex gap-4">
                        {listing.url_imagen && (
                            <img src={listing.url_imagen} alt="Producto" className="w-16 h-16 rounded-lg object-cover bg-white" />
                        )}
                        <div>
                            <span className="text-xs font-bold text-indigo-600 uppercase tracking-wide">Publicación Venta</span>
                            <h3 className="font-semibold text-slate-900 text-lg leading-tight mt-0.5">{listing.titulo}</h3>
                            <p className="text-sm text-slate-600 mt-1">{listing.external_item_id} • ${listing.precio_venta}</p>
                        </div>
                    </div>

                    {/* Buscador de Bodega */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Buscar en tu Bodega (Catálogo Real)
                        </label>
                        <div className="relative">
                            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                placeholder="Escribe el nombre o SKU físico..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />

                            {/* Resultados Autocomplete */}
                            {searchResults.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto overflow-hidden">
                                    {searchResults.map(res => (
                                        <button
                                            key={res.sku}
                                            className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0"
                                            onClick={() => handleAddSku(res)}
                                        >
                                            <div>
                                                <p className="font-medium text-slate-800 text-sm">{res.nombre}</p>
                                                <p className="text-xs text-slate-500">{res.sku}</p>
                                            </div>
                                            <Plus className="w-4 h-4 text-indigo-600" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Lista de Seleccionados (El KIT / Ensamble) */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Artículos que se descontarán por cada venta (Ensamble)
                        </label>
                        <div className="bg-slate-50 rounded-xl border border-slate-200 p-2 space-y-2 min-h-[100px]">
                            {loading ? (
                                <div className="text-center text-slate-500 py-4 text-sm">Cargando mapeos previos...</div>
                            ) : selectedSkus.length === 0 ? (
                                <div className="text-center text-slate-400 py-6 text-sm flex flex-col items-center">
                                    <Package className="w-8 h-8 mb-2 opacity-50" />
                                    No has añadido artículos reales. Usa el buscador de arriba.
                                </div>
                            ) : (
                                selectedSkus.map(s => (
                                    <div key={s.sku} className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                                        <div className="flex-1 flex flex-col">
                                            <span className="font-semibold text-slate-800 text-sm">{s.name}</span>
                                            <span className="text-xs text-slate-500 font-mono mt-0.5">{s.sku}</span>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="flex flex-col items-end">
                                                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Cantidad por unidad vendida</span>
                                                <div className="flex items-center mt-1 border border-slate-200 rounded-md overflow-hidden bg-slate-50">
                                                    <button onClick={() => handleQuantityChange(s.sku, s.quantity - 1)} className="px-2 py-1 text-slate-500 hover:bg-slate-200 font-bold">-</button>
                                                    <input
                                                        type="number"
                                                        value={s.quantity}
                                                        onChange={(e) => handleQuantityChange(s.sku, parseInt(e.target.value) || 1)}
                                                        className="w-12 text-center text-sm font-semibold bg-transparent border-none appearance-none p-0 focus:ring-0"
                                                    />
                                                    <button onClick={() => handleQuantityChange(s.sku, s.quantity + 1)} className="px-2 py-1 text-slate-500 hover:bg-slate-200 font-bold">+</button>
                                                </div>
                                            </div>
                                            <button onClick={() => handleRemoveSku(s.sku)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                </div>

                {/* Footer / Actions */}
                <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-200 bg-slate-100 rounded-lg transition-colors"
                        disabled={saving}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || selectedSkus.length === 0}
                        className="px-6 py-2 font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-md shadow-indigo-200 transition-all flex items-center gap-2"
                    >
                        {saving ? (
                            <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                Guardando...
                            </>
                        ) : 'Guardar y Enlazar'}
                    </button>
                </div>

            </div>
        </div>
    );
}
