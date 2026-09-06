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
    onSuccess,
    importacionId
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
    importacionId?: string;
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
            let res: Response;
            if (importacionId) {
                // Contexto vinculación: crea alias LOCKED (para que pase a "ya_vinculado").
                res = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/vincular-lote`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        importacion_id: importacionId,
                        items: [{
                            codigo_excel: itemProveedor.codigo || '',
                            modelo_excel: itemProveedor.modelo || '',
                            marca_excel: itemProveedor.marca || '',
                            articulo_id: articulo.articulo_id
                        }]
                    })
                });
            } else {
                res = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/vincular`, {
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
            }

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
        <div className="fixed inset-0 z-50 bg-[var(--surface-2)]/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[var(--surface)] rounded-2xl shadow-2xl border border-[var(--border)] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
                {/* Header */}
                <div className="p-6 border-b border-[var(--border)] flex items-start justify-between bg-[var(--bg)]/50">
                    <div>
                        <span className="text-xs font-bold uppercase tracking-wider text-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-1 rounded-md">
                            Vincular a tu Catálogo
                        </span>
                        <h3 className="text-lg font-bold text-[var(--text)] mt-2">
                            {itemProveedor.modelo || itemProveedor.codigo}
                        </h3>
                        <p className="text-xs text-[var(--text-muted)] line-clamp-1 mt-0.5">
                            {itemProveedor.marca} · {itemProveedor.descripcion}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-[var(--text-faint)] hover:text-[var(--text-muted)] p-1.5 hover:bg-[var(--surface-2)] rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-6 pb-2">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-[var(--text-faint)]" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => handleSearch(e.target.value)}
                            placeholder="Buscar por nombre, modelo, código en tu catálogo..."
                            className="w-full pl-10 pr-4 py-2.5 text-sm border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] bg-[var(--bg)]/50"
                            autoFocus
                        />
                        {buscando && (
                            <Loader2 className="w-4 h-4 absolute right-3.5 top-3.5 text-[var(--text-faint)] animate-spin" />
                        )}
                    </div>
                    {error && <p className="text-xs text-[var(--err)] mt-2 font-medium">{error}</p>}
                </div>

                {/* Results List */}
                <div className="flex-1 overflow-y-auto p-6 pt-2 space-y-2">
                    {resultados.length === 0 && !buscando ? (
                        <div className="text-center py-12 text-[var(--text-faint)] text-sm">
                            {query ? 'No se encontraron artículos en tu catálogo' : 'Escribe para buscar en tus productos...'}
                        </div>
                    ) : (
                        resultados.map(art => (
                            <div
                                key={art.articulo_id}
                                className="p-3.5 rounded-xl border border-[var(--border)] hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/10 transition-all flex items-center justify-between gap-4 group"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-xs font-bold text-[var(--text-muted)] bg-[var(--surface-2)] px-2 py-0.5 rounded">
                                            {art.modelo || art.articulo_id}
                                        </span>
                                        <span className="text-xs font-semibold text-[var(--text-muted)]">{art.marca}</span>
                                    </div>
                                    <p className="text-sm font-medium text-[var(--text)] truncate mt-1">
                                        {art.nombre}
                                    </p>
                                </div>

                                <button
                                    onClick={() => handleVincular(art)}
                                    disabled={!!vinculando}
                                    className="px-4 py-2 bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50"
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
