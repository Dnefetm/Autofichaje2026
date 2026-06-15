"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, AlertCircle, Search, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

export default function NuevaFichaPage() {
    const router = useRouter();
    const [nombreProducto, setNombreProducto] = useState('');
    const [articuloId, setArticuloId] = useState('');
    const [articuloNombre, setArticuloNombre] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Búsqueda de artículos
    const [q, setQ] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);

    async function buscarArticulos() {
        if (q.trim().length < 2) return;
        setSearchLoading(true);
        const { data, error: err } = await supabase
            .from('articulos')
            .select('articulo_id, nombre, marca')
            .or(`nombre.ilike.%${q}%,articulo_id.ilike.%${q}%`)
            .limit(5);
        setSearchLoading(false);
        if (!err) setSearchResults(data || []);
    }

    function seleccionarArticulo(art: any) {
        setArticuloId(art.articulo_id);
        setArticuloNombre(`${art.nombre} (${art.marca || 'Sin marca'})`);
        if (!nombreProducto) {
            setNombreProducto(art.nombre); // Sugerir el nombre del artículo
        }
        setSearchResults([]);
        setQ('');
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!nombreProducto.trim()) {
            setError('El nombre del producto es obligatorio');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const res = await fetch('/api/fichas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombre_producto: nombreProducto,
                    articulo_id: articuloId || null,
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al crear la ficha');

            // Redirigir a la vista de edición de la nueva ficha
            router.push(`/fichas/${data.id}`);
        } catch (err: any) {
            setError(err.message);
            setLoading(false);
        }
    }

    return (
        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center gap-3">
                <button type="button" onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Nueva Ficha Técnica</h2>
                    <p className="text-slate-500 text-sm mt-0.5">Crea una ficha manualmente en estado borrador</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
                {error && (
                    <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700">
                        <AlertCircle className="w-5 h-5 shrink-0" /><p className="text-sm">{error}</p>
                    </div>
                )}

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                            Nombre del Producto *
                        </label>
                        <input 
                            type="text" 
                            autoFocus
                            value={nombreProducto} 
                            onChange={e => setNombreProducto(e.target.value)}
                            placeholder="Ej. Samsung Galaxy S23 Ultra"
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-1 focus:ring-indigo-500 outline-none" 
                        />
                    </div>

                    <div className="space-y-2 pt-4 border-t border-slate-100">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                            Vincular Artículo del Catálogo (Opcional)
                        </label>
                        
                        {articuloId ? (
                            <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm">
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                    <span className="font-medium">{articuloNombre}</span>
                                    <span className="text-emerald-600/70 text-xs font-mono">({articuloId})</span>
                                </div>
                                <button type="button" onClick={() => { setArticuloId(''); setArticuloNombre(''); }} className="text-emerald-700 hover:text-rose-600 text-xs font-bold px-2">
                                    Quitar
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                    <input 
                                        type="text" 
                                        placeholder="Buscar por SKU o Nombre..." 
                                        value={q} 
                                        onChange={e => setQ(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), buscarArticulos())}
                                        className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-1 focus:ring-indigo-500 outline-none" 
                                    />
                                    <button type="button" onClick={buscarArticulos} disabled={searchLoading || q.length < 2} className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50">
                                        {searchLoading ? 'Buscando...' : 'Buscar'}
                                    </button>
                                </div>
                                {searchResults.length > 0 && (
                                    <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                                        {searchResults.map(art => (
                                            <div key={art.articulo_id} className="p-3 hover:bg-slate-50 flex items-center justify-between transition-colors">
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-700">{art.nombre}</p>
                                                    <p className="text-xs text-slate-400 font-mono">{art.articulo_id} • {art.marca}</p>
                                                </div>
                                                <button type="button" onClick={() => seleccionarArticulo(art)} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-bold transition-colors">
                                                    Seleccionar
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        <p className="text-xs text-slate-400">Si no lo vinculas ahora, podrás hacerlo más tarde desde la ficha.</p>
                    </div>
                </div>

                <div className="pt-6 flex items-center justify-end gap-3 border-t border-slate-100">
                    <Link href="/fichas" className="px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                        Cancelar
                    </Link>
                    <button type="submit" disabled={loading || !nombreProducto.trim()} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-60 flex items-center gap-2">
                        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                        Crear Ficha
                    </button>
                </div>
            </form>
        </div>
    );
}
