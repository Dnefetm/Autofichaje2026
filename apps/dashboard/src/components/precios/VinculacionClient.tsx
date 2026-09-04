'use client';
import { useCallback, useEffect, useState } from 'react';
import { VinculacionCategoria } from './VinculacionCategoria';
import { AlertCircle, FileX, Loader2, RefreshCw, Unlink } from 'lucide-react';
import {
    MatchItem,
    VinculacionCategoriaId,
    VinculacionTotales,
    TOTALES_VACIOS,
} from './vinculacion-types';

interface CategoriaState {
    items: MatchItem[];
    page: number; // próxima página a pedir (0-based)
    hasMore: boolean;
    loading: boolean;
    loaded: boolean;
    error?: string;
}

const EMPTY_CAT: CategoriaState = { items: [], page: 0, hasMore: false, loading: false, loaded: false };

interface Props {
    importacionId: string;
    proveedor: string;
}

export function VinculacionClient({ importacionId, proveedor }: Props) {
    const [tab, setTab] = useState<'propuestas' | 'vinculados' | 'sin_match' | 'ignorados'>('propuestas');
    const [totales, setTotales] = useState<VinculacionTotales>(TOTALES_VACIOS);
    const [cats, setCats] = useState<Record<VinculacionCategoriaId, CategoriaState>>({
        triple: { ...EMPTY_CAT },
        solo_codigo: { ...EMPTY_CAT },
        marca_modelo: { ...EMPTY_CAT },
        ya_vinculado: { ...EMPTY_CAT },
        sin_match: { ...EMPTY_CAT },
        rechazado: { ...EMPTY_CAT },
    });
    const [priming, setPriming] = useState(true);
    const [globalError, setGlobalError] = useState<string | null>(null);

    const fetchCategoria = useCallback(async (categoria: VinculacionCategoriaId, page: number, append: boolean) => {
        setCats((prev) => ({ ...prev, [categoria]: { ...prev[categoria], loading: true, error: undefined } }));
        try {
            const res = await fetch(
                `/api/precios/importaciones/${importacionId}/vinculacion?categoria=${categoria}&page=${page}&pageSize=100&proveedor=${encodeURIComponent(proveedor)}`
            );
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.ok) {
                const msg = data?.error || `HTTP ${res.status}`;
                setCats((prev) => ({ ...prev, [categoria]: { ...prev[categoria], loading: false, error: msg } }));
                setGlobalError(msg);
                return;
            }
            setTotales(data.totales);
            setCats((prev) => {
                const cur = prev[categoria];
                const items = append ? [...cur.items, ...data.rows] : data.rows;
                return {
                    ...prev,
                    [categoria]: {
                        items,
                        page: data.page + 1,
                        hasMore: data.hasMore,
                        loading: false,
                        loaded: true,
                        error: undefined,
                    },
                };
            });
        } catch (e: any) {
            setCats((prev) => ({ ...prev, [categoria]: { ...prev[categoria], loading: false, error: e?.message || 'Error de red' } }));
            setGlobalError(e?.message || 'Error de red');
        }
    }, [importacionId, proveedor]);

    // Carga inicial: la 1ª llamada materializa (una sola vez, ~3.7s) y el resto
    // trae la 1ª página de cada categoría. Así las pestañas abren al instante.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setPriming(true);
            setGlobalError(null);
            await fetchCategoria('triple', 0, false); // "prima" la materialización
            await Promise.all([
                fetchCategoria('solo_codigo', 0, false),
                fetchCategoria('marca_modelo', 0, false),
                fetchCategoria('ya_vinculado', 0, false),
                fetchCategoria('sin_match', 0, false),
                fetchCategoria('rechazado', 0, false),
            ]);
            if (!cancelled) setPriming(false);
        })();
        return () => { cancelled = true; };
    }, [fetchCategoria]);

    const openTab = (next: 'propuestas' | 'vinculados' | 'sin_match' | 'ignorados') => {
        setTab(next);
        // Fallback: si una categoría falló en la carga inicial, reintenta al abrir.
        if (next === 'vinculados' && !cats.ya_vinculado.loaded && !cats.ya_vinculado.loading) {
            fetchCategoria('ya_vinculado', 0, false);
        }
        if (next === 'sin_match' && !cats.sin_match.loaded && !cats.sin_match.loading) {
            fetchCategoria('sin_match', 0, false);
        }
        if (next === 'ignorados' && !cats.rechazado.loaded && !cats.rechazado.loading) {
            fetchCategoria('rechazado', 0, false);
        }
    };

    const loadMore = (categoria: VinculacionCategoriaId) => {
        const cur = cats[categoria];
        if (cur.loading || !cur.hasMore) return;
        fetchCategoria(categoria, cur.page, true);
    };

    // UPDATE OPTIMISTA (H1): al aceptar, la ficha desaparece al instante en el
    // cliente (sin esperar el POST ni la re-materialización del servidor).
    const handleAccepted = useCallback((categoria: VinculacionCategoriaId, items: MatchItem[]) => {
        const ids = new Set(items.map((i) => i.fila_num));
        setCats((prev) => ({
            ...prev,
            [categoria]: {
                ...prev[categoria],
                items: prev[categoria].items.filter((i) => !ids.has(i.fila_num)),
            },
            // Invalida "ya_vinculado" para que la próxima apertura recargue.
            ya_vinculado: { ...EMPTY_CAT, loaded: false },
        }));
        setTotales((prev) => ({
            ...prev,
            [categoria]: Math.max(0, prev[categoria] - items.length),
            ya_vinculado: prev.ya_vinculado + items.length,
        }));
    }, []);

    // Si el POST falla, restaura recargando la categoría (el servidor no cambió).
    const handleRollback = useCallback((categoria: VinculacionCategoriaId) => {
        setCats((prev) => ({ ...prev, ya_vinculado: { ...EMPTY_CAT, loaded: false } }));
        fetchCategoria(categoria, 0, false);
    }, [fetchCategoria]);

    // "Ignorar" persistente: quita la fila de su categoría y la mueve a "rechazado".
    const handleRejected = useCallback((categoria: VinculacionCategoriaId, items: MatchItem[]) => {
        const ids = new Set(items.map((i) => i.fila_num));
        setCats((prev) => ({
            ...prev,
            [categoria]: { ...prev[categoria], items: prev[categoria].items.filter((i) => !ids.has(i.fila_num)) },
            rechazado: { ...EMPTY_CAT, loaded: false },
        }));
        setTotales((prev) => ({
            ...prev,
            [categoria]: Math.max(0, prev[categoria] - items.length),
            rechazado: prev.rechazado + items.length,
        }));
    }, []);

    // "Restaurar" una fila ignorada: la quita del rechazo y reaparece en su categoría.
    const handleRestore = useCallback(async (item: MatchItem) => {
        const res = await fetch(`/api/precios/importaciones/${importacionId}/vinculacion/rechazar`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fila_num: item.fila_num }),
        });
        if (!res.ok) { alert('No se pudo restaurar. Inténtalo de nuevo.'); return; }
        fetchCategoria('rechazado', 0, false);
        setCats((prev) => ({
            ...prev,
            triple: { ...EMPTY_CAT, loaded: false },
            solo_codigo: { ...EMPTY_CAT, loaded: false },
            marca_modelo: { ...EMPTY_CAT, loaded: false },
            ya_vinculado: { ...EMPTY_CAT, loaded: false },
            sin_match: { ...EMPTY_CAT, loaded: false },
        }));
    }, [importacionId, fetchCategoria]);

    // "Desvincular" (quitar el vínculo): borra el alias manual y re-materializa.
    const handleDesvincular = useCallback(async (item: MatchItem) => {
        if (!confirm('¿Desvincular este producto? Volverá a las propuestas de vinculación.')) return;
        const res = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/desvincular-vinculo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                importacion_id: importacionId,
                codigo_excel: item.codigo_barra,
                marca_excel: item.marca_proveedor,
                modelo_excel: item.sku_proveedor,
            }),
        });
        if (!res.ok) { alert('No se pudo desvincular. Inténtalo de nuevo.'); return; }
        fetchCategoria('ya_vinculado', 0, false);
        setCats((prev) => ({
            ...prev,
            triple: { ...EMPTY_CAT, loaded: false },
            solo_codigo: { ...EMPTY_CAT, loaded: false },
            marca_modelo: { ...EMPTY_CAT, loaded: false },
            sin_match: { ...EMPTY_CAT, loaded: false },
        }));
    }, [importacionId, proveedor, fetchCategoria]);

    const totalPropuestas = totales.triple + totales.solo_codigo + totales.marca_modelo;

    const fmtMx = (n: number) => (n > 0 ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—');

    const tabClass = (active: boolean) =>
        `pb-2 pt-1.5 text-sm font-bold border-b-2 transition-colors ${active ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'}`;

    return (
        <div className="flex flex-col flex-1">
            <div className="px-4 border-b border-[var(--border)] bg-[var(--surface)]">
                <div className="flex gap-5 overflow-x-auto">
                    <button onClick={() => openTab('propuestas')} className={tabClass(tab === 'propuestas')}>
                        Propuestas ({totalPropuestas.toLocaleString()})
                    </button>
                    <button onClick={() => openTab('vinculados')} className={tabClass(tab === 'vinculados')}>
                        Ya Vinculados ({totales.ya_vinculado.toLocaleString()})
                    </button>
                    <button onClick={() => openTab('sin_match')} className={tabClass(tab === 'sin_match')}>
                        Sin Coincidencia ({totales.sin_match.toLocaleString()})
                    </button>
                    <button onClick={() => openTab('ignorados')} className={tabClass(tab === 'ignorados')}>
                        Ignorados ({totales.rechazado.toLocaleString()})
                    </button>
                </div>
            </div>

            <div className="p-3 w-full">
                {globalError && !priming && (
                    <div className="mb-4 flex items-center gap-2 text-xs text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-lg px-3 py-2">
                        <AlertCircle className="w-4 h-4 shrink-0" /> {globalError}
                    </div>
                )}

                {priming && (
                    <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-muted)]">
                        <Loader2 className="w-4 h-4 animate-spin" /> Cargando vinculación…
                    </div>
                )}

                {/* Tab: Propuestas */}
                {!priming && tab === 'propuestas' && (
                    <div className="flex flex-col gap-4">
                        {totalPropuestas === 0 ? (
                            <div className="bg-[var(--surface)] p-12 text-center rounded-xl border border-[var(--border)] text-[var(--text-faint)]">
                                ¡Todo revisado! No quedan artículos pendientes de vincular en este lote.
                            </div>
                        ) : (
                            <>
                                {totales.triple > 0 && (
                                    <VinculacionCategoria
                                        categoria="triple"
                                        titulo="Coincidencia Exacta (Triple)"
                                        descripcion="Marca, Modelo y Código de Barras coinciden exactamente."
                                        importacionId={importacionId}
                                        proveedor={proveedor}
                                        items={cats.triple.items}
                                        total={totales.triple}
                                        hasMore={cats.triple.hasMore}
                                        loadingMore={cats.triple.loading}
                                        onLoadMore={() => loadMore('triple')}
                                        onAccepted={(items) => handleAccepted('triple', items)}
                                        onRollback={() => handleRollback('triple')}
                                        onRejected={(items) => handleRejected('triple', items)}
                                    />
                                )}
                                {totales.solo_codigo > 0 && (
                                    <VinculacionCategoria
                                        categoria="solo_codigo"
                                        titulo="Solo Código de Barras coincide"
                                        descripcion="El EAN coincide pero la marca o modelo del Excel difieren ligeramente."
                                        importacionId={importacionId}
                                        proveedor={proveedor}
                                        items={cats.solo_codigo.items}
                                        total={totales.solo_codigo}
                                        hasMore={cats.solo_codigo.hasMore}
                                        loadingMore={cats.solo_codigo.loading}
                                        onLoadMore={() => loadMore('solo_codigo')}
                                        onAccepted={(items) => handleAccepted('solo_codigo', items)}
                                        onRollback={() => handleRollback('solo_codigo')}
                                        onRejected={(items) => handleRejected('solo_codigo', items)}
                                    />
                                )}
                                {totales.marca_modelo > 0 && (
                                    <VinculacionCategoria
                                        categoria="marca_modelo"
                                        titulo="Solo Marca + Modelo coinciden"
                                        descripcion="No hay código de barras en el Excel para comparar."
                                        importacionId={importacionId}
                                        proveedor={proveedor}
                                        items={cats.marca_modelo.items}
                                        total={totales.marca_modelo}
                                        hasMore={cats.marca_modelo.hasMore}
                                        loadingMore={cats.marca_modelo.loading}
                                        onLoadMore={() => loadMore('marca_modelo')}
                                        onAccepted={(items) => handleAccepted('marca_modelo', items)}
                                        onRollback={() => handleRollback('marca_modelo')}
                                        onRejected={(items) => handleRejected('marca_modelo', items)}
                                    />
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* Tab: Ya Vinculados */}
                {tab === 'vinculados' && (
                    <ListaVinculados
                        items={cats.ya_vinculado.items}
                        total={totales.ya_vinculado}
                        loading={cats.ya_vinculado.loading}
                        hasMore={cats.ya_vinculado.hasMore}
                        onLoadMore={() => loadMore('ya_vinculado')}
                        onDesvincular={handleDesvincular}
                    />
                )}

                {/* Tab: Sin Match */}
                {tab === 'sin_match' && (
                    <ListaSinMatch
                        items={cats.sin_match.items}
                        total={totales.sin_match}
                        loading={cats.sin_match.loading}
                        hasMore={cats.sin_match.hasMore}
                        onLoadMore={() => loadMore('sin_match')}
                        fmtMx={fmtMx}
                    />
                )}

                {/* Tab: Ignorados */}
                {tab === 'ignorados' && (
                    <ListaIgnorados
                        items={cats.rechazado.items}
                        total={totales.rechazado}
                        loading={cats.rechazado.loading}
                        hasMore={cats.rechazado.hasMore}
                        onLoadMore={() => loadMore('rechazado')}
                        onRestore={handleRestore}
                    />
                )}
            </div>
        </div>
    );
}

function ListaVinculados(props: {
    items: MatchItem[];
    total: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onDesvincular: (item: MatchItem) => void;
}) {
    const { items, total, loading, hasMore, onLoadMore, onDesvincular } = props;
    return (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden shadow-sm">
            <div className="px-6 py-4 bg-[var(--ok)]/10 border-b border-[var(--ok)]/30 flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-[var(--text)] flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-[var(--ok)]" />
                        Artículos ya vinculados ({total.toLocaleString()})
                    </h3>
                    <p className="text-xs text-[var(--ok)] mt-0.5">Fueron confirmados en sesiones anteriores.</p>
                </div>
            </div>
            {items.length === 0 && !loading ? (
                <div className="p-8 text-center text-[var(--text-faint)]">No hay artículos vinculados.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-[var(--bg)]">
                            <tr className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-faint)] border-b border-[var(--border)]">
                                <th className="py-2.5 px-4 text-left">SKU / Descripción Proveedor</th>
                                <th className="py-2.5 px-4 text-left">EAN Proveedor</th>
                                <th className="py-2.5 px-4 text-left">Artículo Interno Vinculado</th>
                                <th className="py-2.5 px-4 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                            {items.map((item) => (
                                <tr key={item.fila_num} className="hover:bg-[var(--bg)]/50">
                                    <td className="py-2.5 px-4">
                                        <span className="font-mono font-bold text-[var(--text)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">{item.sku_proveedor}</span>
                                        <p className="text-[var(--text-muted)] mt-0.5 line-clamp-1">{item.descripcion_proveedor}</p>
                                    </td>
                                    <td className="py-2.5 px-4 font-mono text-[var(--text-muted)]">{item.codigo_barra || '—'}</td>
                                    <td className="py-2.5 px-4">
                                        <p className="font-semibold text-[var(--ok)] line-clamp-1">{item.nombre_catalogo}</p>
                                        <p className="text-[var(--text-muted)] text-[10px]">Mod: {item.modelo_catalogo || '—'} · EAN: {item.codigo_universal || '—'}</p>
                                    </td>
                                    <td className="py-2.5 px-4 text-right">
                                        <button
                                            onClick={() => onDesvincular(item)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--surface-2)] hover:bg-[var(--err)]/10 border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--err)] rounded-lg text-xs font-bold transition-colors"
                                        >
                                            <Unlink className="w-3.5 h-3.5" /> Desvincular
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <PieCarga
                cargados={items.length}
                total={total}
                loading={loading}
                hasMore={hasMore}
                onLoadMore={onLoadMore}
            />
        </div>
    );
}

function ListaSinMatch(props: {
    items: MatchItem[];
    total: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    fmtMx: (n: number) => string;
}) {
    const { items, total, loading, hasMore, onLoadMore, fmtMx } = props;
    return (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden shadow-sm">
            <div className="px-6 py-4 bg-[var(--bg)] border-b border-[var(--border)] flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-[var(--text)] flex items-center gap-2">
                        <FileX className="w-4 h-4 text-[var(--text-faint)]" />
                        Artículos sin coincidencia ({total.toLocaleString()})
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">No se encontró código de barras ni modelo en tu catálogo.</p>
                </div>
            </div>
            {items.length === 0 && !loading ? (
                <div className="p-8 text-center text-[var(--text-faint)]">Todos los artículos tienen coincidencia.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-[var(--bg)]">
                            <tr className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-faint)] border-b border-[var(--border)]">
                                <th className="py-2.5 px-4 text-left">SKU Proveedor</th>
                                <th className="py-2.5 px-4 text-left">Marca</th>
                                <th className="py-2.5 px-4 text-left">Descripción</th>
                                <th className="py-2.5 px-4 text-left">EAN Proveedor</th>
                                <th className="py-2.5 px-4 text-right">Menudeo</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                            {items.map((item) => (
                                <tr key={item.fila_num} className="hover:bg-[var(--bg)]/50">
                                    <td className="py-2.5 px-4 font-mono font-bold text-[var(--text-muted)]">{item.sku_proveedor}</td>
                                    <td className="py-2.5 px-4 text-[var(--text-muted)]">{item.marca_proveedor}</td>
                                    <td className="py-2.5 px-4 text-[var(--text)] line-clamp-1 max-w-[300px]">{item.descripcion_proveedor}</td>
                                    <td className="py-2.5 px-4 font-mono text-[var(--text-muted)]">{item.codigo_barra || '—'}</td>
                                    <td className="py-2.5 px-4 text-right font-semibold text-[var(--text)]">{fmtMx(item.menudeo)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <PieCarga
                cargados={items.length}
                total={total}
                loading={loading}
                hasMore={hasMore}
                onLoadMore={onLoadMore}
            />
        </div>
    );
}

function ListaIgnorados(props: {
    items: MatchItem[];
    total: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onRestore: (item: MatchItem) => void;
}) {
    const { items, total, loading, hasMore, onLoadMore, onRestore } = props;
    return (
        <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] overflow-hidden shadow-sm">
            <div className="px-6 py-4 bg-[var(--bg)] border-b border-[var(--border)] flex items-center justify-between">
                <div>
                    <h3 className="font-bold text-[var(--text)] flex items-center gap-2">
                        <FileX className="w-4 h-4 text-[var(--text-faint)]" />
                        Artículos ignorados ({total.toLocaleString()})
                    </h3>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">Los ignoraste de la vinculación. Puedes restaurarlos y volverán a sus propuestas.</p>
                </div>
            </div>
            {items.length === 0 && !loading ? (
                <div className="p-8 text-center text-[var(--text-faint)]">No hay artículos ignorados.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-[var(--bg)]">
                            <tr className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-faint)] border-b border-[var(--border)]">
                                <th className="py-2.5 px-4 text-left">SKU Proveedor</th>
                                <th className="py-2.5 px-4 text-left">Marca</th>
                                <th className="py-2.5 px-4 text-left">Descripción</th>
                                <th className="py-2.5 px-4 text-left">EAN</th>
                                <th className="py-2.5 px-4 text-right">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                            {items.map((item) => (
                                <tr key={item.fila_num} className="hover:bg-[var(--bg)]/50">
                                    <td className="py-2.5 px-4 font-mono font-bold text-[var(--text-muted)]">{item.sku_proveedor}</td>
                                    <td className="py-2.5 px-4 text-[var(--text-muted)]">{item.marca_proveedor}</td>
                                    <td className="py-2.5 px-4 text-[var(--text)] line-clamp-1 max-w-[300px]">{item.descripcion_proveedor}</td>
                                    <td className="py-2.5 px-4 font-mono text-[var(--text-muted)]">{item.codigo_barra || '—'}</td>
                                    <td className="py-2.5 px-4 text-right">
                                        <button
                                            onClick={() => onRestore(item)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--surface-2)] hover:bg-[var(--ok)]/10 border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--ok)] rounded-lg text-xs font-bold transition-colors"
                                        >
                                            <RefreshCw className="w-3.5 h-3.5" /> Restaurar
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <PieCarga
                cargados={items.length}
                total={total}
                loading={loading}
                hasMore={hasMore}
                onLoadMore={onLoadMore}
            />
        </div>
    );
}

function PieCarga(props: {
    cargados: number;
    total: number;
    loading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
}) {
    const { cargados, total, loading, hasMore, onLoadMore } = props;
    if (total === 0) return null;
    return (
        <div className="px-4 py-3 border-t border-[var(--border)] flex justify-between items-center bg-[var(--bg)]">
            <span className="text-xs text-[var(--text-muted)]">Mostrando {cargados.toLocaleString()} de {total.toLocaleString()}</span>
            {hasMore && (
                <button
                    onClick={onLoadMore}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-xs font-bold disabled:opacity-50"
                >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    Cargar más
                </button>
            )}
        </div>
    );
}
