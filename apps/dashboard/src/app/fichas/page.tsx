"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, Filter, RefreshCcw, Loader2, FileText, ExternalLink, AlertCircle, Trash2 } from 'lucide-react';

type Estado = '' | 'borrador' | 'revision' | 'publicado';

interface Ficha {
    id:              string;
    estado:          string;
    nombre_producto: string;
    descripcion?:    string;
    articulo_id?:    string;
    created_at:      string;
    articulos?: { nombre: string; marca: string; modelo?: string } | null;
}

function EstadoBadge({ estado }: { estado: string }) {
    const map: Record<string, string> = {
        borrador:  'bg-[var(--surface-2)] text-[var(--text-muted)]',
        revision:  'bg-[var(--warn)]/10 text-[var(--warn)]',
        publicado: 'bg-[var(--ok)]/10 text-[var(--ok)]',
    };
    return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${map[estado] || 'bg-[var(--surface-2)] text-[var(--text-muted)]'}`}>{estado}</span>;
}

export default function FichasPage() {
    const [fichas, setFichas]   = useState<Ficha[]>([]);
    const [total, setTotal]     = useState(0);
    const [page, setPage]       = useState(1);
    const [pages, setPages]     = useState(1);
    const [q, setQ]             = useState('');
    const [estado, setEstado]   = useState<Estado>('');
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState('');
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchFichas = useCallback(async (p = page, query = q, est = estado) => {
        setLoading(true); setError('');
        try {
            const params = new URLSearchParams({ page: String(p), limit: '20' });
            if (query) params.set('q', query);
            if (est)   params.set('estado', est);
            const res  = await fetch(`/api/fichas?${params}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al cargar fichas');
            setFichas(data.fichas ?? []);
            setTotal(data.total ?? 0);
            setPages(data.pages ?? 1);
        } catch (e: any) {
            setError(e.message);
        }
        setLoading(false);
    }, [page, q, estado]);

    useEffect(() => { fetchFichas(); }, [fetchFichas]);

    async function eliminarFichaLista(f: Ficha) {
        if (!window.confirm(`¿Eliminar "${f.nombre_producto || 'esta ficha'}"?\nEsta acción no se puede deshacer.`)) return;
        setDeletingId(f.id);
        try {
            const res  = await fetch(`/api/fichas/${f.id}`, { method: 'DELETE' });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
                setFichas(prev => prev.filter(x => x.id !== f.id));
                setTotal(prev => Math.max(0, prev - 1));
            } else {
                setError(body?.error || 'No se pudo eliminar la ficha.');
            }
        } catch (err: any) {
            setError(err?.message || 'Error de red.');
        }
        setDeletingId(null);
    }

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(1);
        fetchFichas(1, q, estado);
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Fichas Técnicas</h2>
                    <p className="text-[var(--text-muted)] text-sm mt-0.5">{total} fichas en total</p>
                </div>
                <div className="flex gap-2">
                    <Link href="/fichas/nueva"
                        className="px-4 py-2 bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-semibold rounded-xl hover:brightness-110 transition-colors flex items-center gap-2">
                        <FileText className="w-4 h-4" /> Nueva ficha
                    </Link>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-4">
                <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)]" />
                        <input type="text" placeholder="Buscar por nombre o SKU…" value={q} onChange={e => setQ(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 border border-[var(--border)] rounded-xl text-sm focus:ring-1 focus:ring-[var(--accent)] outline-none" />
                    </div>
                    <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-[var(--text-faint)] shrink-0" />
                        <select value={estado} onChange={e => { setEstado(e.target.value as Estado); setPage(1); fetchFichas(1, q, e.target.value as Estado); }}
                            className="border border-[var(--border)] rounded-xl text-sm px-3 py-2.5 focus:ring-1 focus:ring-[var(--accent)] outline-none bg-[var(--surface)]">
                            <option value="">Todos los estados</option>
                            <option value="borrador">Borrador</option>
                            <option value="revision">En revisión</option>
                            <option value="publicado">Publicada</option>
                        </select>
                    </div>
                    <button type="submit" className="px-4 py-2.5 bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-semibold rounded-xl hover:brightness-110 transition-colors">
                        Buscar
                    </button>
                    <button type="button" onClick={() => fetchFichas()} className="p-2.5 border border-[var(--border)] rounded-xl hover:bg-[var(--bg)] text-[var(--text-muted)]">
                        <RefreshCcw className="w-4 h-4" />
                    </button>
                </form>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-start gap-3 p-4 bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-xl text-[var(--err)]">
                    <AlertCircle className="w-5 h-5 shrink-0" /><p className="text-sm">{error}</p>
                </div>
            )}

            {/* Tabla */}
            <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] overflow-hidden shadow-sm">
                {loading ? (
                    <div className="flex items-center justify-center py-20 text-[var(--text-faint)]">
                        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Cargando fichas…
                    </div>
                ) : fichas.length === 0 ? (
                    <div className="text-center py-20 text-[var(--text-faint)]">
                        <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
                        <p className="font-medium">No hay fichas técnicas</p>
                        <p className="text-sm mt-1">Crea una nueva desde <Link href="/autoficha" className="text-[var(--accent)] underline">Crear con IA</Link></p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-[var(--bg)] border-b border-[var(--border)]">
                            <tr>
                                <th className="text-left px-5 py-3 text-[10px] font-bold text-[var(--text-faint)] uppercase tracking-widest">Producto</th>
                                <th className="text-left px-5 py-3 text-[10px] font-bold text-[var(--text-faint)] uppercase tracking-widest">Artículo vinculado</th>
                                <th className="text-left px-5 py-3 text-[10px] font-bold text-[var(--text-faint)] uppercase tracking-widest">Estado</th>
                                <th className="text-left px-5 py-3 text-[10px] font-bold text-[var(--text-faint)] uppercase tracking-widest">Fecha</th>
                                <th className="px-5 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                            {fichas.map(f => (
                                <tr key={f.id} className="hover:bg-[var(--bg)] transition-colors">
                                    <td className="px-5 py-4">
                                        <p className="font-semibold text-[var(--text)] line-clamp-1">{f.nombre_producto || '—'}</p>
                                        {f.descripcion && <p className="text-xs text-[var(--text-faint)] line-clamp-1 mt-0.5">{f.descripcion}</p>}
                                    </td>
                                    <td className="px-5 py-4">
                                        {f.articulo_id ? (
                                            <div>
                                                <p className="font-mono text-xs text-[var(--text-muted)]">{f.articulo_id}</p>
                                                {f.articulos && <p className="text-xs text-[var(--text-faint)] mt-0.5">{f.articulos.nombre} — {f.articulos.marca}</p>}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-[var(--err)] font-medium">Sin vincular</span>
                                        )}
                                    </td>
                                    <td className="px-5 py-4"><EstadoBadge estado={f.estado} /></td>
                                    <td className="px-5 py-4 text-xs text-[var(--text-faint)] whitespace-nowrap">
                                        {new Date(f.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </td>
                                    <td className="px-5 py-4 text-right">
                                        <div className="flex items-center justify-end gap-3">
                                            <Link href={`/fichas/${f.id}`}
                                                className="inline-flex items-center gap-1 text-[var(--accent)] hover:text-[var(--accent)] text-xs font-semibold">
                                                Ver <ExternalLink className="w-3 h-3" />
                                            </Link>
                                            {f.estado !== 'publicado' && (
                                                <button
                                                    type="button"
                                                    aria-label="Eliminar ficha"
                                                    onClick={() => eliminarFichaLista(f)}
                                                    disabled={deletingId === f.id}
                                                    className="p-1.5 text-[var(--text-faint)] hover:text-[var(--err)] hover:bg-[var(--err)]/10 rounded-lg transition-colors disabled:opacity-50">
                                                    {deletingId === f.id
                                                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                        : <Trash2 className="w-3.5 h-3.5" />}
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Paginación */}
            {pages > 1 && (
                <div className="flex items-center justify-center gap-3">
                    <button onClick={() => { const np = page - 1; setPage(np); fetchFichas(np); }} disabled={page <= 1}
                        className="px-4 py-2 border border-[var(--border)] rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-[var(--bg)]">
                        ← Anterior
                    </button>
                    <span className="text-sm text-[var(--text-muted)]">Página {page} de {pages}</span>
                    <button onClick={() => { const np = page + 1; setPage(np); fetchFichas(np); }} disabled={page >= pages}
                        className="px-4 py-2 border border-[var(--border)] rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-[var(--bg)]">
                        Siguiente →
                    </button>
                </div>
            )}
        </div>
    );
}
