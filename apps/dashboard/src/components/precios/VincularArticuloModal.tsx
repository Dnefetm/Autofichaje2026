'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, Loader2, X, Link as LinkIcon, Check } from 'lucide-react';

interface ArticuloSearchResult {
    articulo_id: string;
    nombre: string;
    modelo: string;
    marca: string;
    codigo_universal: string | null;
}

export function VincularArticuloModal({
    proveedor,
    itemProveedor,
    onClose,
    onSuccess
}: {
    proveedor: string;
    itemProveedor: {
        codigo: string;
        modelo: string;
        marca: string;
        descripcion: string;
        precio_distribuidor?: any;
    };
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [query, setQuery] = useState(itemProveedor.modelo || itemProveedor.codigo || '');
    const [resultados, setResultados] = useState<ArticuloSearchResult[]>([]);
    const [buscando, setBuscando] = useState(false);
    const [vinculando, setVinculando] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleSearch = (q: string) => {
        setQuery(q);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        if (!q.trim()) {
            setResultados([]);
            return;
        }

        debounceRef.current = setTimeout(async () => {
            setBuscando(true);
            setError(null);
            try {
                const res = await fetch(`/api/articulos/buscar?query=${encodeURIComponent(q)}&limit=15`);
                const data = await res.json();
                setResultados(data.items || []);
            } catch (err: any) {
                setError('Error al buscar artículos');
            } finally {
                setBuscando(false);
            }
        }, 250);
    };

    useEffect(() => {
        if (query) {
            handleSearch(query);
        }
    }, []);

    const handleVincular = async (articulo: ArticuloSearchResult) => {
        setVinculando(articulo.articulo_id);
        setError(null);
        try {
            const res = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/vincular`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    articulo_id: articulo.articulo_id,
                    codigo_excel: itemProveedor.codigo || '',
                    marca_excel: itemProveedor.marca || '',
                    modelo_excel: itemProveedor.modelo || '',
                    valor: itemProveedor.precio_distribuidor,
                    tipo_costo: 'distribuidor',
                    moneda: 'MXN'
                })
            });

            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo vincular');

            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setVinculando(null);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
                    <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-md">
                            Vincular a tu Catálogo
                        </span>
                        <h3 className="text-lg font-bold text-slate-900 mt-2">
                            {itemProveedor.modelo || itemProveedor.codigo}
                        </h3>
                        <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                            {itemProveedor.marca} · {itemProveedor.descripcion}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-6 pb-2">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => handleSearch(e.target.value)}
                            placeholder="Buscar por nombre, modelo, código en tu catálogo..."
                            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-slate-50/50"
                            autoFocus
                        />
                        {buscando && (
                            <Loader2 className="w-4 h-4 absolute right-3.5 top-3.5 text-slate-400 animate-spin" />
                        )}
                    </div>
                    {error && <p className="text-xs text-rose-600 mt-2 font-medium">{error}</p>}
                </div>

                {/* Results List */}
                <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-2">
                    {resultados.length === 0 && !buscando ? (
                        <div className="text-center py-12 text-slate-400 text-sm">
                            {query ? 'No se encontraron artículos en tu catálogo' : 'Escribe para buscar en tus productos...'}
                        </div>
                    ) : (
                        resultados.map(art => (
                            <div
                                key={art.articulo_id}
                                className="p-3.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all flex items-center justify-between gap-4 group"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                                            {art.modelo || art.articulo_id}
                                        </span>
                                        <span className="text-xs font-semibold text-slate-500">{art.marca}</span>
                                    </div>
                                    <p className="text-sm font-medium text-slate-900 truncate mt-1">
                                        {art.nombre}
                                    </p>
                                </div>

                                <button
                                    onClick={() => handleVincular(art)}
                                    disabled={!!vinculando}
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                                >
                                    {vinculando === art.articulo_id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                        <LinkIcon className="w-3.5 h-3.5" />
                                    )}
                                    Vincular
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
