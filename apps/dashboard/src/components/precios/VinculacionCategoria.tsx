'use client';
import React, { useState } from 'react';
import { Loader2, Check, X, ChevronDown, ChevronUp, Package, Building2 } from 'lucide-react';

interface MatchItem {
    fila_num: number;
    sku_proveedor: string;
    codigo_barra: string;
    marca_proveedor: string;
    descripcion_proveedor: string;
    dist: number;
    menudeo: number;
    articulo_id: string;
    nombre_catalogo: string;
    marca_catalogo: string;
    modelo_catalogo: string;
    codigo_universal: string;
}

interface Props {
    onAccepted?: (items: MatchItem[]) => void;
    categoria: string;
    titulo: string;
    descripcion: string;
    color: 'emerald' | 'amber' | 'blue';
    items: MatchItem[];
    proveedor: string;
}

const fmtMx = (n: number) => n > 0 ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—';

export function VinculacionCategoria({ onAccepted, categoria, titulo, descripcion, color, items, proveedor }: Props) {
    const [expandido, setExpandido] = useState(true);
    const [aceptando, setAceptando] = useState(false);
    const [aceptados, setAceptados] = useState<Set<number>>(new Set());
    const [rechazados, setRechazados] = useState<Set<number>>(new Set());

    const colorMap = {
        emerald: { bg: 'bg-[var(--ok)]/10', border: 'border-[var(--ok)]/30', badge: 'bg-emerald-100 text-emerald-800', btn: 'bg-emerald-600 hover:bg-emerald-700 text-white', title: 'text-emerald-800' },
        amber: { bg: 'bg-[var(--warn)]/10', border: 'border-[var(--warn)]/30', badge: 'bg-amber-100 text-amber-800', btn: 'bg-amber-500 hover:bg-amber-600 text-white', title: 'text-amber-800' },
        blue: { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', btn: 'bg-blue-600 hover:bg-blue-700 text-white', title: 'text-blue-800' },
    };
    const c = colorMap[color];

    const pendientes = items.filter(i => !aceptados.has(i.fila_num) && !rechazados.has(i.fila_num));

    const handleAceptarTodos = async () => {
        if (!confirm(`¿Confirmas vincular los ${pendientes.length} artículos de la categoría "${titulo}"?`)) return;
        setAceptando(true);
        try {
            const res = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/vincular-lote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: pendientes.map(i => ({
                        codigo_excel: i.codigo_barra,
                        modelo_excel: i.sku_proveedor,
                        marca_excel: i.marca_proveedor,
                        articulo_id: i.articulo_id
                    }))
                })
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.ok) {
                setAceptados(new Set(items.map(i => i.fila_num)));
                if (onAccepted) onAccepted(pendientes);
            } else {
                alert(`Error: ${data?.error || `HTTP ${res.status}`}`);
            }
        } catch {
            alert('Error de red');
        } finally {
            setAceptando(false);
        }
    };

    const handleAceptarUno = async (item: MatchItem) => {
        try {
            const res = await fetch(`/api/precios/proveedor/${encodeURIComponent(proveedor)}/vincular-lote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: [{
                        codigo_excel: item.codigo_barra,
                        modelo_excel: item.sku_proveedor,
                        marca_excel: item.marca_proveedor,
                        articulo_id: item.articulo_id
                    }]
                })
            });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.ok) {
                setAceptados(prev => new Set([...prev, item.fila_num]));
                if (onAccepted) onAccepted([item]);
            } else {
                alert(`Error al vincular: ${data?.error || `HTTP ${res.status}`}`);
            }
        } catch {
            alert('Error de red');
        }
    };

    const highlightDiff = (val1: string, val2: string) => {
        if (!val1 || !val2) return false;
        return val1.trim().toLowerCase() !== val2.trim().toLowerCase();
    };

    return (
        <div className={`rounded-2xl border ${c.border} overflow-hidden shadow-sm mb-6`}>
            {/* Header de categoría (compacto) */}
            <div className={`${c.bg} px-4 py-2.5 flex items-center justify-between gap-3`}>
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={() => setExpandido(!expandido)}
                        className="text-[var(--text-muted)] hover:text-[var(--text)] bg-[var(--surface)]/60 rounded p-1 shrink-0"
                        aria-label={expandido ? 'Colapsar' : 'Expandir'}
                    >
                        {expandido ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <div className="min-w-0">
                        <h3 className={`font-bold text-sm ${c.title} truncate`}>{titulo}</h3>
                        <p className="text-[11px] text-[var(--text-muted)] truncate hidden sm:block">{descripcion}</p>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold shrink-0 ${c.badge}`}>
                        {pendientes.length} pendientes
                    </span>
                </div>
                {pendientes.length > 0 && (
                    <button
                        onClick={handleAceptarTodos}
                        disabled={aceptando}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-50 ${c.btn}`}
                    >
                        {aceptando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Aceptar todos ({pendientes.length})
                    </button>
                )}
            </div>

            {expandido && (
                <div className="overflow-y-auto max-h-[calc(100vh-210px)]">
                    {/* Cabecera de columnas (solo escritorio) */}
                    <div className="hidden md:grid grid-cols-[1fr_1fr_150px] text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)] bg-[var(--surface-2)] border-b border-[var(--border)] sticky top-0 z-10">
                        <div className="px-4 py-2 border-r border-[var(--border)]">Catálogo</div>
                        <div className="px-4 py-2 border-r border-[var(--border)]">Proveedor</div>
                        <div className="px-4 py-2 text-center">Acción</div>
                    </div>

                    <div className="divide-y divide-[var(--border)]">
                        {items.map((item) => {
                            const isAceptado = aceptados.has(item.fila_num);
                            const isRechazado = rechazados.has(item.fila_num);

                            const diffMarca = highlightDiff(item.marca_catalogo, item.marca_proveedor);
                            const diffModelo = highlightDiff(item.modelo_catalogo, item.sku_proveedor);
                            const diffCodigo = highlightDiff(item.codigo_universal, item.codigo_barra);

                            const rowBg = isAceptado ? 'bg-[var(--ok)]/5'
                                : isRechazado ? 'bg-[var(--bg)] opacity-40'
                                : 'hover:bg-[var(--bg)]/60';

                            return (
                                <div
                                    key={item.fila_num}
                                    className={`grid grid-cols-1 md:grid-cols-[1fr_1fr_150px] gap-y-2 md:gap-y-0 px-4 py-2.5 transition-colors ${rowBg}`}
                                >
                                    {/* CATÁLOGO */}
                                    <div className="min-w-0 md:pr-4 md:border-r border-[var(--border)]">
                                        <div className="flex items-center gap-1.5 mb-0.5">
                                            <Package className="w-3.5 h-3.5 text-[var(--text-faint)] shrink-0" />
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Catálogo</span>
                                        </div>
                                        <p className="font-semibold text-[var(--text)] truncate leading-tight" title={item.nombre_catalogo}>{item.nombre_catalogo || '—'}</p>
                                        <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                                            <span className={diffMarca ? 'text-[var(--warn)] font-semibold' : ''}>{item.marca_catalogo || '—'}</span>
                                            <span className="opacity-50"> · </span>
                                            <span className={diffModelo ? 'text-[var(--warn)] font-semibold font-mono' : 'font-mono'}>{item.modelo_catalogo || '—'}</span>
                                            <span className="opacity-50"> · EAN </span>
                                            <span className={`font-mono ${diffCodigo ? 'text-[var(--warn)] font-semibold' : ''}`}>{item.codigo_universal || '—'}</span>
                                        </p>
                                    </div>

                                    {/* PROVEEDOR */}
                                    <div className="min-w-0 md:px-4">
                                        <div className="flex items-center gap-1.5 mb-0.5">
                                            <Building2 className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">{proveedor}</span>
                                        </div>
                                        <p className="text-[var(--text)] truncate leading-tight" title={item.descripcion_proveedor}>{item.descripcion_proveedor || item.sku_proveedor || '—'}</p>
                                        <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                                            <span className="font-mono font-semibold">{item.sku_proveedor || '—'}</span>
                                            <span className="opacity-50"> · </span>
                                            <span>{item.marca_proveedor || '—'}</span>
                                            <span className="opacity-50"> · EAN </span>
                                            <span className="font-mono">{item.codigo_barra || '—'}</span>
                                        </p>
                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono text-[var(--text-muted)]">
                                            <span>Dist: <b className="text-[var(--text)]">{fmtMx(item.dist)}</b></span>
                                            <span>Men: <b className="text-[var(--text)]">{fmtMx(item.menudeo)}</b></span>
                                        </div>
                                    </div>

                                    {/* ACCIÓN */}
                                    <div className="flex md:flex-col gap-1.5 md:justify-center md:pl-4 md:border-l border-[var(--border)]">
                                        {isAceptado ? (
                                            <span className="inline-flex items-center justify-center gap-1.5 text-emerald-700 font-bold text-xs bg-emerald-100 border border-emerald-300 py-2 px-2 rounded-lg"><Check className="w-4 h-4" /> Vinculado</span>
                                        ) : isRechazado ? (
                                            <span className="inline-flex items-center justify-center gap-1.5 text-[var(--text-muted)] font-bold text-xs bg-[var(--surface-2)] border border-[var(--border)] py-2 px-2 rounded-lg"><X className="w-4 h-4" /> Ignorado</span>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => handleAceptarUno(item)}
                                                    className="w-full py-1.5 px-2 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-800 rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                                                >
                                                    <Check className="w-3.5 h-3.5" /> Aceptar
                                                </button>
                                                <button
                                                    onClick={() => setRechazados(prev => new Set([...prev, item.fila_num]))}
                                                    className="w-full py-1.5 px-2 bg-[var(--surface)] hover:bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-1.5"
                                                >
                                                    <X className="w-3.5 h-3.5" /> Ignorar
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
