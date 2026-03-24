"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';
import { X, Search, Package, Save, RefreshCw, Plus, Trash2, Tag, Barcode, Info } from 'lucide-react';

interface MappingModalProps {
    listing: any;
    onClose: () => void;
    onSuccess: () => void;
}

function stringSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const al = a.toLowerCase().trim();
    const bl = b.toLowerCase().trim();
    if (al === bl) return 1;
    if (al.length < 2 || bl.length < 2) return 0;
    const bigrams = new Map<string, number>();
    for (let i = 0; i < al.length - 1; i++) {
        const bi = al.substring(i, i + 2);
        bigrams.set(bi, (bigrams.get(bi) || 0) + 1);
    }
    let intersect = 0;
    for (let i = 0; i < bl.length - 1; i++) {
        const bi = bl.substring(i, i + 2);
        const count = bigrams.get(bi) || 0;
        if (count > 0) { bigrams.set(bi, count - 1); intersect++; }
    }
    return (2 * intersect) / ((al.length - 1) + (bl.length - 1));
}

export default function MappingModal({ listing, onClose, onSuccess }: MappingModalProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [selectedSkus, setSelectedSkus] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [smartSuggestions, setSmartSuggestions] = useState<any[]>([]);
    const [suggestionsLoading, setSuggestionsLoading] = useState(false);

    const pubSku = listing?.seller_custom_field || listing?.seller_sku || '';
    const pubEan = listing?.ean || '';
    const pubGtin = listing?.gtin || '';
    const pubUpc = listing?.upc || '';
    const pubModel = listing?.model || '';
    const pubBrand = listing?.brand || '';
    const pubTitle = listing?.titulo || '';

    useEffect(() => {
        if (listing) {
            loadExistingMappings();
            loadSmartSuggestions();
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

    async function loadSmartSuggestions() {
        setSuggestionsLoading(true);
        try {
            // Recopilar TODOS los identificadores de la publicacion
            const allSkus = [listing?.seller_custom_field, listing?.seller_sku].filter(Boolean);
            const allGtins = [listing?.gtin, listing?.ean, listing?.upc].filter(Boolean);
            const allModels = [listing?.model].filter(Boolean);
            const brand = listing?.brand || '';
            const title = listing?.titulo || '';

            // Construir query OR amplia
            const orParts: string[] = [];
            // Buscar por SKU en articulo_id, sku y modelo del articulo
            for (const s of allSkus) {
                orParts.push(`articulo_id.ilike.%${s}%`);
                orParts.push(`sku.ilike.%${s}%`);
                orParts.push(`modelo.ilike.%${s}%`);
                orParts.push(`codigo_universal.ilike.%${s}%`);
            }
            // Buscar por modelo
            for (const m of allModels) {
                orParts.push(`modelo.ilike.%${m}%`);
                orParts.push(`articulo_id.ilike.%${m}%`);
                orParts.push(`sku.ilike.%${m}%`);
            }
            // Buscar por GTIN/EAN en codigo_universal
            for (const g of allGtins) {
                orParts.push(`codigo_universal.ilike.%${g}%`);
            }
            // Buscar por marca
            if (brand) {
                orParts.push(`marca.ilike.%${brand}%`);
            }

            if (orParts.length === 0) { setSuggestionsLoading(false); return; }

            const { data, error } = await supabase
                .from('articulos')
                .select('articulo_id, nombre, marca, modelo, variante, codigo_universal, sku, caja_madre')
                .not('nombre', 'like', '%PLACEHOLDER%')
                .or(orParts.join(','))
                .limit(50);

            if (error) throw error;
            if (data && data.length > 0) {
                const scored = data.map(item => {
                    let score = 0;
                    const iId = (item.articulo_id || '').toLowerCase();
                    const iSku = (item.sku || '').toLowerCase();
                    const iMod = (item.modelo || '').toLowerCase();
                    const iCod = (item.codigo_universal || '').toLowerCase();
                    const iMarca = (item.marca || '').toLowerCase();
                    const iNombre = (item.nombre || '').toLowerCase();

                    // PRIORIDAD 1: SKU exacto (+5) o parcial (+3)
                    for (const s of allSkus) {
                        const sl = s.toLowerCase();
                        if (iId === sl || iSku === sl || iMod === sl) { score += 5; break; }
                        if (iId.includes(sl) || iSku.includes(sl) || iMod.includes(sl)) { score += 3; break; }
                    }
                    // PRIORIDAD 2: Modelo exacto (+4) o parcial (+2)
                    for (const m of allModels) {
                        const ml = m.toLowerCase();
                        if (iMod === ml) { score += 4; break; }
                        if (iMod.includes(ml) || iId.includes(ml)) { score += 2; break; }
                    }
                    // PRIORIDAD 3: GTIN/EAN match (+3)
                    for (const g of allGtins) {
                        const gl = g.toLowerCase().replace(/^0+/, '');
                        const iCodClean = iCod.replace(/^0+/, '');
                        if (iCodClean === gl || iCod === g.toLowerCase()) { score += 3; break; }
                        if (iCodClean.includes(gl) || gl.includes(iCodClean)) { score += 2; break; }
                    }
                    // PRIORIDAD 4: Marca exacta (+1)
                    if (brand && iMarca === brand.toLowerCase()) score += 1;
                    // PRIORIDAD 5: Similitud de nombre (+0 a +0.5)
                    score += stringSimilarity(title, item.nombre || '') * 0.5;

                    return { ...item, _score: score };
                });
                scored.sort((a, b) => b._score - a._score);
                setSmartSuggestions(scored.filter(s => s._score > 0.5));
            }
        } catch (error) {
            console.error('Error cargando sugerencias:', error);
        } finally {
            setSuggestionsLoading(false);
        }
    }
    useEffect(() => {
        const debounce = setTimeout(() => {
            if (searchTerm.length >= 2) { searchPhysicalCatalog(); } else { setSearchResults([]); }
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
            if (error) { console.error('Error buscando articulos:', error.message); setSearchResults([]); return; }
            const ref = pubSku || pubEan || '';
            if (ref && data) {
                const scored = data.map(item => ({ ...item, _score: Math.max(stringSimilarity(ref, item.articulo_id || ''), stringSimilarity(ref, item.sku || ''), stringSimilarity(ref, item.codigo_universal || '')) }));
                scored.sort((a, b) => b._score - a._score);
                setSearchResults(scored);
            } else { setSearchResults(data || []); }
        } catch (error) { console.error('Error buscando articulos fisicos:', error); setSearchResults([]); }
    }

    function handleAddSku(product: any) {
        if (selectedSkus.find(s => s.sku === product.articulo_id)) return;
        setSelectedSkus([...selectedSkus, { sku: product.articulo_id, name: product.nombre, marca: product.marca || '', modelo: product.modelo || '', variante: product.variante || '', codigo_universal: product.codigo_universal || '', caja_madre: product.caja_madre || '', sku_code: product.sku || '', quantity: 1, mapping_id: null }]);
        setSearchTerm('');
    }
    function handleRemoveSku(sku: string) { setSelectedSkus(selectedSkus.filter(s => s.sku !== sku)); }
    function handleQuantityChange(sku: string, qty: number) { if (qty < 1) return; setSelectedSkus(selectedSkus.map(s => s.sku === sku ? { ...s, quantity: qty } : s)); }

    async function handleSave() {
        if (selectedSkus.length === 0) { alert('Debes seleccionar al menos un articulo del catalogo real.'); return; }
        setSaving(true);
        try {
            const { error: delError } = await supabase.from('mapeo_publicacion_articulo').delete().eq('publicacion_id', listing.id);
            if (delError) throw delError;
            const snapshotUpserts = selectedSkus.map(s => ({ sku: s.sku, physical_stock: 0, updated_at: new Date().toISOString() }));
            await supabase.from('inventory_snapshot').upsert(snapshotUpserts, { onConflict: 'sku', ignoreDuplicates: true });
            const inserts = selectedSkus.map(s => ({ publicacion_id: listing.id, articulo_id: s.sku, cantidad_requerida: s.quantity }));
            const { error: insError } = await supabase.from('mapeo_publicacion_articulo').insert(inserts);
            if (insError) throw insError;
            const { error: jobError } = await supabase.from('jobs').insert({ type: 'sync_stock_mapped', payload: { publicacion_id: listing.id }, status: 'pending', scheduled_at: new Date().toISOString() });
            if (jobError) console.error('Aviso: no se pudo encolar el Job.', jobError);
            await dispatchWorker();
            onSuccess();
            onClose();
        } catch (error) { console.error('Error guardando el mapeo:', error); alert('Ocurrio un error al guardar el mapeo.'); }
        finally { setSaving(false); }
    }

    const filteredSuggestions = smartSuggestions.filter(s => !selectedSkus.find(sel => sel.sku === s.articulo_id));

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-white">
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Mapear a Bodega Fisica</h2>
                        <p className="text-xs text-slate-500">Vincula esta vitrina con 1 o mas productos reales.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X size={20} /></button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                    <div className="bg-gradient-to-r from-slate-50 to-indigo-50 rounded-xl p-4 border border-slate-200">
                        <div className="flex gap-4">
                            {listing.url_imagen && (<img src={listing.url_imagen} alt="Producto" className="w-20 h-20 object-contain rounded-lg bg-white border border-slate-200 flex-shrink-0" />)}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">Publicacion Venta</span>
                                    {listing.condition && <span className="text-[10px] text-slate-500 bg-white px-1.5 py-0.5 rounded border">{listing.condition === 'new' ? 'Nuevo' : 'Usado'}</span>}
                                </div>
                                <h3 className="font-semibold text-sm text-slate-800 leading-tight truncate">{listing.titulo}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{listing.external_item_id} &bull; ${listing.precio_venta}</p>
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {pubSku && (<span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-md font-mono"><Tag size={10} /> SKU: {pubSku}</span>)}
                                    {pubEan && (<span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-mono"><Barcode size={10} /> EAN: {pubEan}</span>)}
                                    {pubGtin && pubGtin !== pubEan && (<span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-mono"><Barcode size={10} /> GTIN: {pubGtin}</span>)}
                                    {pubUpc && pubUpc !== pubEan && pubUpc !== pubGtin && (<span className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-md font-mono">UPC: {pubUpc}</span>)}
                                    {pubBrand && (<span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">Marca: {pubBrand}</span>)}
                                    {pubModel && (<span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">Modelo: {pubModel}</span>)}
                                    {listing.domain_id && (<span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md">{listing.domain_id}</span>)}
                                </div>
                            </div>
                        </div>
                    </div>

                    {(suggestionsLoading || filteredSuggestions.length > 0) && (
                        <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                            <h4 className="text-xs font-bold text-green-800 flex items-center gap-1.5 mb-2">
                                <RefreshCw size={12} className={suggestionsLoading ? 'animate-spin' : ''} />
                                {suggestionsLoading ? 'Buscando coincidencias...' : `${filteredSuggestions.length} sugerencia${filteredSuggestions.length !== 1 ? 's' : ''} por similitud`}
                            </h4>
                            {!suggestionsLoading && filteredSuggestions.slice(0, 8).map(res => (
                                <button key={res.articulo_id} onClick={() => handleAddSku(res)} className="w-full text-left p-2 mb-1 rounded-lg hover:bg-green-100 border border-transparent hover:border-green-300 transition-all flex items-center justify-between group">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-slate-800 truncate">{res.nombre}</p>
                                        <div className="flex flex-wrap gap-1 mt-0.5">
                                            {res.marca && <span className="text-[10px] text-slate-500">{res.marca}</span>}
                                            {res.sku && <span className="text-[10px] font-mono text-amber-600 bg-amber-50 px-1 rounded">SKU: {res.sku}</span>}
                                            {res.codigo_universal && <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1 rounded">Cod: {res.codigo_universal}</span>}
                                                                        {res.modelo && <span className="text-[10px] text-slate-400">Mod: {res.modelo}</span>}
                                                                        {res.variante && <span className="text-[10px] text-slate-400">Var: {res.variante}</span>}
                                                                        {res.caja_madre && <span className="text-[10px] text-slate-400">Caja: {res.caja_madre}</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {res._score >= 3 && <span className="text-[9px] bg-green-200 text-green-800 px-1.5 py-0.5 rounded-full font-bold">Alta</span>}
                                        {res._score >= 1.5 && res._score < 3 && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Media</span>}
                                        {res._score < 1.5 && <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">Baja</span>}
                                        <span className="text-[10px] font-mono text-slate-400">{res.articulo_id}</span>
                                        <Plus size={14} className="text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    <div>
                        <label className="text-xs font-semibold text-slate-700 mb-1.5 block">Buscar en tu Bodega (Catalogo Real)</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input type="text" className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all" placeholder="Busca por nombre, marca, modelo, SKU, codigo universal..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                        {searchResults.length > 0 && (
                            <div className="mt-2 border border-slate-200 rounded-lg bg-white shadow-lg max-h-48 overflow-y-auto">
                                {searchResults.map(res => (
                                    <button key={res.articulo_id} className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 border-b border-slate-100 last:border-0 transition-colors flex items-center justify-between" onClick={() => handleAddSku(res)}>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-slate-800 truncate">{res.nombre}</p>
                                            <div className="flex flex-wrap gap-1 mt-0.5">
                                                {res.marca && <span className="text-[10px] text-slate-500">{res.marca}</span>}
                                                {res.sku && <span className="text-[10px] font-mono text-amber-600 bg-amber-50 px-1 rounded">SKU: {res.sku}</span>}
                                                {res.codigo_universal && <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1 rounded">Cod: {res.codigo_universal}</span>}
                                                                                                {res.modelo && <span className="text-[10px] text-slate-400">Mod: {res.modelo}</span>}
                                                {res.variante && <span className="text-[10px] text-slate-400">Var: {res.variante}</span>}
                                                {res.caja_madre && <span className="text-[10px] text-slate-400">Caja: {res.caja_madre}</span>}
                                            </div>
                                        </div>
                                        <span className="text-[10px] font-mono text-slate-400 ml-2 flex-shrink-0">{res.articulo_id}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-2"><Package size={14} /> Articulos que se descontaran por cada venta (Ensamble)</h4>
                        {loading ? (
                            <div className="text-center py-4 text-sm text-slate-400"><RefreshCw size={16} className="inline animate-spin mr-2" />Cargando mapeos previos...</div>
                        ) : selectedSkus.length === 0 ? (
                            <div className="text-center py-6 text-sm text-slate-400 bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">No has agregado articulos reales. Usa el buscador o las sugerencias.</div>
                        ) : (
                            selectedSkus.map(s => (
                                <div key={s.sku} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg mb-2 hover:shadow-sm transition-shadow">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-slate-800 truncate">{s.name}</p>
                                        <div className="flex flex-wrap gap-1 mt-0.5">
                                            {s.marca && <span className="text-[10px] text-slate-500">{s.marca}</span>}
                                            {s.sku_code && <span className="text-[10px] font-mono text-amber-600 bg-amber-50 px-1 rounded">SKU: {s.sku_code}</span>}
                                                                                        {s.modelo && <span className="text-[10px] text-slate-400">Mod: {s.modelo}</span>}
                                            {s.variante && <span className="text-[10px] text-slate-400">Var: {s.variante}</span>}
                                            {s.caja_madre && <span className="text-[10px] text-slate-400">Caja: {s.caja_madre}</span>}
                                            {s.codigo_universal && <span className="text-[10px] font-mono text-blue-600 bg-blue-50 px-1 rounded">Cod: {s.codigo_universal}</span>}
                                        </div>
                                        <span className="text-[10px] font-mono text-slate-400 mt-0.5 block">{s.sku}</span>
                                    </div>
                                    <button onClick={() => handleRemoveSku(s.sku)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={14} /></button>
                                    <div className="text-center">
                                        <span className="text-[10px] text-slate-400 block mb-1">Cantidad</span>
                                        <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                                            <button onClick={() => handleQuantityChange(s.sku, s.quantity - 1)} className="px-2 py-1 text-slate-500 hover:bg-slate-200 font-bold">-</button>
                                            <input type="number" value={s.quantity} onChange={(e) => handleQuantityChange(s.sku, parseInt(e.target.value) || 1)} className="w-12 text-center text-sm font-semibold bg-transparent border-none appearance-none p-0 focus:ring-0" />
                                            <button onClick={() => handleQuantityChange(s.sku, s.quantity + 1)} className="px-2 py-1 text-slate-500 hover:bg-slate-200 font-bold">+</button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">Cancelar</button>
                    <button onClick={handleSave} disabled={saving || selectedSkus.length === 0} className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-2">
                        {saving ? (<><RefreshCw size={14} className="animate-spin" />Guardando...</>) : <><Save size={14} />Guardar y Enlazar</>}
                    </button>
                </div>
            </div>
        </div>
    );
}
