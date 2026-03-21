"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Search, Package, Save, RefreshCw, Plus, Trash2 } from 'lucide-react';

interface MappingModalProps {
    listing: any;
    onClose: () => void;
    onSuccess: () => void;
}

export default function MappingModal({ listing, onClose, onSuccess }: MappingModalProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [selectedSkus, setSelectedSkus] = useState<any[]>([]); // { sku, name, marca, modelo, variante, codigo_universal, caja_madre, quantity, mapping_id }
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
                    articulo_id,
                    articulos (nombre, articulo_id, marca, modelo, variante, codigo_universal, sku, caja_madre)
                `)
                .eq('publicacion_id', listing.id);

            if (error) throw error;

            if (data) {
                const mapped = data.map((d: any) => ({
                    mapping_id: d.id,
                    sku: d.articulo_id,
                    name: d.articulos?.nombre || 'Producto Desconocido',
                    marca: d.articulos?.marca || '',
                    modelo: d.articulos?.modelo || '',
                    variante: d.articulos?.variante || '',
                    codigo_universal: d.articulos?.codigo_universal || '',
                    caja_madre: d.articulos?.caja_madre || '',
                    sku_code: d.articulos?.sku || '',
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

    // Buscador en vivo de SKUs fisicos
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
                .select('articulo_id, nombre, marca, modelo, variante, codigo_universal, sku, caja_madre')
                .not('nombre', 'like', '%PLACEHOLDER%')
                .or(`articulo_id.ilike.%${searchTerm}%,nombre.ilike.%${searchTerm}%,marca.ilike.%${searchTerm}%,modelo.ilike.%${searchTerm}%,sku.ilike.%${searchTerm}%,codigo_universal.ilike.%${searchTerm}%`)
                .limit(10);

            if (error) {
                console.error('Error buscando articulos:', error.message);
                setSearchResults([]);
                return;
            }
            setSearchResults(data || []);
        } catch (error) {
            console.error('Error buscando articulos fisicos:', error);
            setSearchResults([]);
        }
    }

    function handleAddSku(product: any) {
        if (selectedSkus.find(s => s.sku === product.articulo_id)) return; // Ya existe
        setSelectedSkus([...selectedSkus, {
            sku: product.articulo_id,
            name: product.nombre,
            marca: product.marca || '',
            modelo: product.modelo || '',
            variante: product.variante || '',
            codigo_universal: product.codigo_universal || '',
            caja_madre: product.caja_madre || '',
            sku_code: product.sku || '',
            quantity: 1,
            mapping_id: null
        }]);
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
            alert('Debes seleccionar al menos un articulo del catalogo real.');
            return;
        }
        setSaving(true);
        try {
            // 1. Borrar mapeos anteriores para esta publicacion
            const { error: delError } = await supabase
                .from('mapeo_publicacion_articulo')
                .delete()
                .eq('publicacion_id', listing.id);
            if (delError) throw delError;

            // 1b. Garantizar que cada SKU mapeado tiene fila en inventory_snapshot
            const snapshotUpserts = selectedSkus.map(s => ({
                sku: s.sku,
                physical_stock: 0,
                updated_at: new Date().toISOString()
            }));
            await supabase.from('inventory_snapshot').upsert(snapshotUpserts, { onConflict: 'sku', ignoreDuplicates: true });

            // 2. Insertar nuevos mapeos
            const inserts = selectedSkus.map(s => ({
                publicacion_id: listing.id,
                articulo_id: s.sku,
                cantidad_requerida: s.quantity
            }));
            const { error: insError } = await supabase
                .from('mapeo_publicacion_articulo')
                .insert(inserts);
            if (insError) throw insError;

            // 3. Crear job para que el Worker sincronice el stock
            const { error: jobError } = await supabase.from('jobs').insert({
                type: 'sync_stock_mapped',
                payload: { publicacion_id: listing.id },
                status: 'pending',
                scheduled_at: new Date().toISOString()
            });
            if (jobError) console.error('Aviso: Mapeo guardado pero no se pudo encolar el Job automatico para el worker.', jobError);

            onSuccess();
            onClose();
        } catch (error) {
            console.error('Error guardando el mapeo:', error);
            alert('Ocurrio un error al guardar el mapeo.');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-slate-200 flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Mapear a Bodega Fisica</h2>
                        <p className="text-sm text-slate-500 mt-1">Vincula esta vitrina con 1 o mas productos reales.</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Tarjeta de Publicacion Origen */}
                    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4 flex items-center gap-4">
                        {listing.url_imagen && (
                            <img src={listing.url_imagen} alt="Producto" className="w-16 h-16 rounded-lg object-cover border" />
                        )}
                        <div>
                            <span className="text-xs font-bold text-purple-600 uppercase tracking-wider">Publicacion Venta</span>
                            <h3 className="font-semibold text-slate-800">{listing.titulo}</h3>
                            <p className="text-sm text-slate-500">{listing.external_item_id} &bull; ${listing.precio_venta}</p>
                        </div>
                    </div>

                    {/* Buscador de Bodega */}
                    <div>
                        <label className="text-sm font-semibold text-slate-700">Buscar en tu Bodega (Catalogo Real)</label>
                        <div className="relative mt-2">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                                placeholder="Busca por nombre, marca, modelo, SKU, codigo universal..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        {/* Resultados Autocomplete */}
                        {searchResults.length > 0 && (
                            <div className="mt-2 border border-slate-200 rounded-lg bg-white shadow-lg max-h-64 overflow-y-auto divide-y divide-slate-100">
                                {searchResults.map(res => (
                                    <button
                                        key={res.articulo_id}
                                        className="w-full text-left px-4 py-3 hover:bg-indigo-50 transition-colors flex justify-between items-start"
                                        onClick={() => handleAddSku(res)}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-slate-800 truncate">{res.nombre}</p>
                                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                                                {res.marca && <span className="text-xs text-indigo-600 font-medium">{res.marca}</span>}
                                                {res.modelo && <span className="text-xs text-slate-500">Mod: {res.modelo}</span>}
                                                {res.variante && <span className="text-xs text-slate-500">Var: {res.variante}</span>}
                                                {res.sku && <span className="text-xs text-slate-500">SKU: {res.sku}</span>}
                                            </div>
                                            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                                                {res.codigo_universal && <span className="text-xs text-slate-400">Cod: {res.codigo_universal}</span>}
                                                {res.caja_madre && <span className="text-xs text-slate-400">Caja: {res.caja_madre}</span>}
                                                <span className="text-xs text-slate-300">{res.articulo_id}</span>
                                            </div>
                                        </div>
                                        <Plus className="w-5 h-5 text-indigo-500 flex-shrink-0 mt-1" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Lista de Seleccionados (El KIT / Ensamble) */}
                    <div>
                        <h4 className="text-sm font-semibold text-slate-700">Articulos que se descontaran por cada venta (Ensamble)</h4>
                        <div className="mt-3 space-y-3">
                            {loading ? (
                                <div className="text-center py-4 text-slate-400"><RefreshCw className="w-5 h-5 animate-spin inline" /> Cargando mapeos previos...</div>
                            ) : selectedSkus.length === 0 ? (
                                <div className="text-center py-4 text-slate-400 text-sm">No has a\u00f1adido articulos reales. Usa el buscador de arriba.</div>
                            ) : (
                                selectedSkus.map(s => (
                                    <div key={s.sku} className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                                                    {s.marca && <span className="text-xs text-indigo-600 font-medium">{s.marca}</span>}
                                                    {s.modelo && <span className="text-xs text-slate-500">Mod: {s.modelo}</span>}
                                                    {s.variante && <span className="text-xs text-slate-500">Var: {s.variante}</span>}
                                                    {s.sku_code && <span className="text-xs text-slate-500">SKU: {s.sku_code}</span>}
                                                </div>
                                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                                                    {s.codigo_universal && <span className="text-xs text-slate-400">Cod: {s.codigo_universal}</span>}
                                                    {s.caja_madre && <span className="text-xs text-slate-400">Caja: {s.caja_madre}</span>}
                                                    <span className="text-xs text-slate-300">{s.sku}</span>
                                                </div>
                                            </div>
                                            <button onClick={() => handleRemoveSku(s.sku)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
                                            <span className="text-xs font-semibold text-slate-500 uppercase">Cantidad por unidad vendida</span>
                                            <div className="ml-auto flex items-center border border-slate-300 rounded-lg bg-white">
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
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer / Actions */}
                <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                        Cancelar
                    </button>
                    <button onClick={handleSave} disabled={saving || selectedSkus.length === 0} className="px-6 py-2.5 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 rounded-xl transition-colors shadow-lg shadow-indigo-500/20">
                        {saving ? (<><RefreshCw className="w-4 h-4 animate-spin inline mr-2" />Guardando...</>) : 'Guardar y Enlazar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
