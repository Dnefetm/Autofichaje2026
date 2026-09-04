'use client';
import React, { Fragment, useState } from 'react';
import { Check, X, ChevronDown, ChevronUp, Package, Building2 } from 'lucide-react';
import { MatchItem } from './vinculacion-types';

interface Props {
    categoria: string;
    titulo: string;
    descripcion: string;
    importacionId: string;
    proveedor: string;
    items: MatchItem[];
    total: number;
    hasMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    onAccepted: (items: MatchItem[]) => void;
    onRollback: () => void;
    onRejected: (items: MatchItem[]) => void;
}

const fmtMx = (n: number) => (n > 0 ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—');

// H6 (POLITICAS_FRONTEND.md): comparación vertical, NO lado a lado.
// Tabla HTML nativa: Fila Superior = Catálogo, Fila Inferior = Proveedor.
export function VinculacionCategoria({
    categoria,
    titulo,
    descripcion,
    importacionId,
    proveedor,
    items,
    total,
    hasMore,
    loadingMore,
    onLoadMore,
    onAccepted,
    onRollback,
    onRejected,
}: Props) {
    const [expandido, setExpandido] = useState(true);
    const [aceptados, setAceptados] = useState<Set<number>>(new Set());
    const [rechazados, setRechazados] = useState<Set<number>>(new Set());
    const [removing, setRemoving] = useState<Set<number>>(new Set());

    const pendientes = items.filter(
        (i) => !aceptados.has(i.fila_num) && !rechazados.has(i.fila_num) && !removing.has(i.fila_num)
    );

    const vincular = async (lista: MatchItem[]) => {
        const res = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/vincular-lote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                importacion_id: importacionId,
                items: lista.map((i) => ({
                    codigo_excel: i.codigo_barra,
                    modelo_excel: i.sku_proveedor,
                    marca_excel: i.marca_proveedor,
                    articulo_id: i.articulo_id,
                })),
            }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
            throw new Error(data?.error || `HTTP ${res.status}`);
        }
    };

    // UPDATE OPTIMISTA (H1): la ficha desaparece al instante con un fundido ligero;
    // el POST corre en segundo plano. Si falla, se revierte y se avisa.
    const confirmar = (lista: MatchItem[]) => {
        const ids = lista.map((i) => i.fila_num);
        setRemoving((prev) => new Set([...prev, ...ids]));

        const p = vincular(lista);

        const t = setTimeout(() => {
            setAceptados((prev) => new Set([...prev, ...ids]));
            onAccepted(lista);
            setRemoving((prev) => {
                const n = new Set(prev);
                ids.forEach((id) => n.delete(id));
                return n;
            });
        }, 160);

        p.catch((e: any) => {
            clearTimeout(t);
            setRemoving((prev) => {
                const n = new Set(prev);
                ids.forEach((id) => n.delete(id));
                return n;
            });
            onRollback();
            alert(`Error al vincular: ${e?.message || 'Error de red'}`);
        });
    };

    const handleAceptarTodos = () => {
        if (pendientes.length === 0) return;
        if (!confirm(`¿Confirmas vincular los ${pendientes.length} artículos de la categoría "${titulo}"?`)) return;
        confirmar(pendientes);
    };

    const handleAceptarUno = (item: MatchItem) => {
        if (removing.has(item.fila_num) || aceptados.has(item.fila_num)) return;
        confirmar([item]);
    };

    // "Ignorar" persistente: guarda en vinculacion_rechazos (optimista).
    const rechazar = async (lista: MatchItem[]) => {
        const res = await fetch(`/api/precios/importaciones/${importacionId}/vinculacion/rechazar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fila_num: lista[0].fila_num }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    };

    const confirmarRechazo = (item: MatchItem) => {
        if (removing.has(item.fila_num) || rechazados.has(item.fila_num)) return;
        const ids = [item.fila_num];
        setRemoving((prev) => new Set([...prev, ...ids]));
        setRechazados((prev) => new Set([...prev, ...ids]));

        const p = rechazar([item]);

        const t = setTimeout(() => {
            onRejected([item]);
            setRemoving((prev) => {
                const n = new Set(prev);
                ids.forEach((id) => n.delete(id));
                return n;
            });
        }, 160);

        p.catch((e: any) => {
            clearTimeout(t);
            setRemoving((prev) => {
                const n = new Set(prev);
                ids.forEach((id) => n.delete(id));
                return n;
            });
            setRechazados((prev) => {
                const n = new Set(prev);
                ids.forEach((id) => n.delete(id));
                return n;
            });
            onRollback();
            alert(`Error al ignorar: ${e?.message || 'Error de red'}`);
        });
    };

    // Diferencias (H4: ámbar/negritas = discrepancia).
    const highlightDiff = (val1: string, val2: string) => {
        if (!val1 || !val2) return false;
        return val1.trim().toLowerCase() !== val2.trim().toLowerCase();
    };

    return (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden shadow-sm mb-6 bg-[var(--surface)]">
            {/* Header de categoría */}
            <div className="px-3 py-1.5 flex items-center justify-between gap-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={() => setExpandido(!expandido)}
                        className="text-[var(--text-muted)] hover:text-[var(--text)] rounded p-1 shrink-0"
                        aria-label={expandido ? 'Colapsar' : 'Expandir'}
                    >
                        {expandido ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <div className="min-w-0">
                        <h3 className="font-bold text-sm text-[var(--text)] truncate">{titulo}</h3>
                        <p className="text-[11px] text-[var(--text-muted)] truncate hidden sm:block">{descripcion}</p>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold shrink-0 bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]">
                        {total.toLocaleString()} total
                    </span>
                </div>
                {pendientes.length > 0 && (
                    <button
                        onClick={handleAceptarTodos}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-[var(--ok)] text-[var(--accent-ink)] hover:brightness-110 transition-all shrink-0"
                    >
                        <Check className="w-3.5 h-3.5" />
                        Aceptar todos ({pendientes.length})
                    </button>
                )}
            </div>

            {expandido && (
                <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                            <thead className="bg-[var(--surface-2)]">
                                <tr className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)] border-b border-[var(--border)]">
                                    <th className="py-1.5 px-2 text-left w-24">Origen</th>
                                    <th className="py-1.5 px-2 text-left">Nombre / Descripción</th>
                                    <th className="py-1.5 px-2 text-left">Marca</th>
                                    <th className="py-1.5 px-2 text-left">Modelo / Clave</th>
                                    <th className="py-1.5 px-2 text-left">EAN</th>
                                    <th className="py-1.5 px-2 text-left">Precios</th>
                                    <th className="py-1.5 px-2 text-center">Acción</th>
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => {
                                    const isAceptado = aceptados.has(item.fila_num);
                                    const isRechazado = rechazados.has(item.fila_num);
                                    const isRemoving = removing.has(item.fila_num);

                                    const diffMarca = highlightDiff(item.marca_catalogo, item.marca_proveedor);
                                    const diffModelo = highlightDiff(item.modelo_catalogo, item.sku_proveedor);
                                    const diffCodigo = highlightDiff(item.codigo_universal, item.codigo_barra);

                                    const rowState = isAceptado
                                        ? 'bg-[var(--ok)]/5'
                                        : isRechazado
                                          ? 'opacity-40'
                                          : '';
                                    const fade = isRemoving
                                        ? 'opacity-0 scale-[0.98] pointer-events-none transition-all duration-150 ease-out'
                                        : 'transition-all duration-150 ease-out';

                                    return (
                                        <Fragment key={item.fila_num}>
                                            {/* Fila Superior: Catálogo (neutro/slate) */}
                                            <tr className={`align-top ${rowState} ${fade}`}>
                                                <td className="py-1.5 px-2">
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                                                        <Package className="w-3.5 h-3.5" /> Catálogo
                                                    </span>
                                                </td>
                                                <td className="py-1.5 px-2 font-semibold text-[var(--text)]" title={item.nombre_catalogo}>
                                                    {item.nombre_catalogo || '—'}
                                                </td>
                                                <td className={`py-1.5 px-2 ${diffMarca ? 'text-[var(--warn)] font-bold' : 'text-[var(--text-muted)]'}`}>
                                                    {item.marca_catalogo || '—'}
                                                </td>
                                                <td className={`py-1.5 px-2 font-mono ${diffModelo ? 'text-[var(--warn)] font-bold' : 'text-[var(--text-muted)]'}`}>
                                                    {item.modelo_catalogo || '—'}
                                                </td>
                                                <td className={`py-1.5 px-2 font-mono ${diffCodigo ? 'text-[var(--warn)] font-bold' : 'text-[var(--text-muted)]'}`}>
                                                    {item.codigo_universal || '—'}
                                                </td>
                                                <td className="py-1.5 px-2 text-[var(--text-faint)]">—</td>
                                                <td className="py-1.5 px-2 text-center align-middle border-l border-[var(--border)]" rowSpan={2}>
                                                    {isAceptado ? (
                                                        <span className="inline-flex items-center justify-center gap-1.5 text-[var(--ok)] font-bold text-xs border border-[var(--ok)]/30 bg-[var(--ok)]/10 py-2 px-2 rounded-lg">
                                                            <Check className="w-4 h-4" /> Vinculado
                                                        </span>
                                                    ) : isRechazado ? (
                                                        <span className="inline-flex items-center justify-center gap-1.5 text-[var(--text-muted)] font-bold text-xs bg-[var(--surface-2)] border border-[var(--border)] py-2 px-2 rounded-lg">
                                                            <X className="w-4 h-4" /> Ignorado
                                                        </span>
                                                    ) : (
                                                        <div className="flex flex-col gap-1.5 items-stretch">
                                                            <button
                                                                onClick={() => handleAceptarUno(item)}
                                                                className="py-1.5 px-2 bg-[var(--ok)]/15 hover:bg-[var(--ok)]/25 border border-[var(--ok)]/30 text-[var(--ok)] rounded-lg font-bold text-xs transition-colors inline-flex items-center justify-center gap-1.5"
                                                            >
                                                                <Check className="w-3.5 h-3.5" /> Aceptar
                                                            </button>
                                                            <button
                                                                onClick={() => confirmarRechazo(item)}
                                                                className="py-1.5 px-2 bg-[var(--surface-2)] hover:bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg font-bold text-xs transition-colors inline-flex items-center justify-center gap-1.5"
                                                            >
                                                                <X className="w-3.5 h-3.5" /> Ignorar
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>

                                            {/* Fila Inferior: Proveedor (índigo/accent) */}
                                            <tr className={`align-top ${rowState} ${fade}`}>
                                                <td className="py-1.5 px-2 border-b border-[var(--border)]">
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
                                                        <Building2 className="w-3.5 h-3.5" /> Proveedor
                                                    </span>
                                                </td>
                                                <td className="py-1.5 px-2 border-b border-[var(--border)] text-[var(--text)]" title={item.descripcion_proveedor}>
                                                    {item.descripcion_proveedor || item.sku_proveedor || '—'}
                                                </td>
                                                <td className={`py-1.5 px-2 border-b border-[var(--border)] ${diffMarca ? 'text-[var(--warn)] font-bold' : 'text-[var(--text-muted)]'}`}>
                                                    {item.marca_proveedor || '—'}
                                                </td>
                                                <td className={`py-1.5 px-2 border-b border-[var(--border)] font-mono ${diffModelo ? 'text-[var(--warn)] font-bold' : 'text-[var(--text-muted)]'}`}>
                                                    {item.sku_proveedor || '—'}
                                                </td>
                                                <td className={`py-1.5 px-2 border-b border-[var(--border)] font-mono ${diffCodigo ? 'text-[var(--warn)] font-bold' : 'text-[var(--text-muted)]'}`}>
                                                    {item.codigo_barra || '—'}
                                                </td>
                                                <td className="py-1.5 px-2 border-b border-[var(--border)] text-[var(--text-muted)] font-mono">
                                                    <span>Dist: <b className="text-[var(--text)]">{fmtMx(item.dist)}</b></span>
                                                    <span className="opacity-50"> · </span>
                                                    <span>Men: <b className="text-[var(--text)]">{fmtMx(item.menudeo)}</b></span>
                                                </td>
                                            </tr>
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {hasMore && (
                        <div className="px-4 py-3 border-t border-[var(--border)] flex justify-center bg-[var(--bg)]">
                            <button
                                onClick={onLoadMore}
                                disabled={loadingMore}
                                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-xs font-bold disabled:opacity-50"
                            >
                                <ChevronDown className="w-3.5 h-3.5" />
                                Cargar más ({items.length.toLocaleString()} de {total.toLocaleString()})
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
