'use client';
import React, { useState } from 'react';
import { Loader2, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useRouter } from 'next/navigation';

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
    const router = useRouter();

    const colorMap = {
        emerald: { bg: 'bg-[var(--ok)]/10', border: 'border-[var(--ok)]/30', badge: 'bg-emerald-100 text-[var(--ok)]', btn: 'bg-emerald-600 hover:bg-emerald-700 text-[var(--accent-ink)]', title: 'text-emerald-800' },
        amber: { bg: 'bg-[var(--warn)]/10', border: 'border-[var(--warn)]/30', badge: 'bg-amber-100 text-[var(--warn)]', btn: 'bg-[var(--warn)]/100 hover:bg-amber-600 text-[var(--accent-ink)]', title: 'text-amber-800' },
        blue: { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', btn: 'bg-blue-600 hover:bg-blue-700 text-[var(--accent-ink)]', title: 'text-blue-800' },
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
            const data = await res.json();
            if (res.ok && data.ok) {
                setAceptados(new Set(items.map(i => i.fila_num)));
                if (onAccepted) onAccepted(pendientes);
            } else {
                alert(`Error: ${data.error}`);
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
            if (res.ok) {
                setAceptados(prev => new Set([...prev, item.fila_num]));
                if (onAccepted) onAccepted([item]);
            }
        } catch {
            alert('Error de red');
        }
    };

    return (
        <div className={`rounded-2xl border ${c.border} overflow-hidden shadow-sm mb-8`}>
            {/* Header de categoría */}
            <div className={`${c.bg} px-6 py-4 flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                    <button onClick={() => setExpandido(!expandido)} className="text-[var(--text-muted)] hover:text-[var(--text-muted)] bg-[var(--surface)]/50 rounded p-1">
                        {expandido ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                    <div>
                        <h3 className={`font-bold text-lg ${c.title}`}>{titulo}</h3>
                        <p className="text-sm text-[var(--text-muted)] mt-0.5">{descripcion}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ml-4 ${c.badge}`}>
                        {pendientes.length} pendientes · {aceptados.size} aceptados · {rechazados.size} ignorados
                    </span>
                </div>
                {pendientes.length > 0 && (
                    <button
                        onClick={handleAceptarTodos}
                        disabled={aceptando}
                        className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm hover:shadow-md ${c.btn} disabled:opacity-50`}
                    >
                        {aceptando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Aceptar todos ({pendientes.length})
                    </button>
                )}
            </div>

            {/* Tabla nativa con doble fila (<tr>) para alinear perfectamente con los <th> */}
            {expandido && (
                <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
                    <table className="w-full text-xs text-left table-fixed min-w-[900px]">
                        <thead className="bg-[var(--surface-2)] sticky top-0 z-10 shadow-sm border-b border-[var(--border)]">
                            <tr className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                                <th className="py-3.5 px-4 w-[90px] text-center border-r border-[var(--border)]">Origen</th>
                                <th className="py-3.5 px-4 w-auto">Descripción / Nombre</th>
                                <th className="py-3.5 px-4 w-[12%]">Marca</th>
                                <th className="py-3.5 px-4 w-[15%]">Modelo / Clave</th>
                                <th className="py-3.5 px-4 w-[18%]">Cód. Barras</th>
                                <th className="py-3.5 px-4 w-[120px] text-center bg-[var(--surface)]">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="bg-[var(--surface)]">
                            {items.map((item) => {
                                const isAceptado = aceptados.has(item.fila_num);
                                const isRechazado = rechazados.has(item.fila_num);
                                
                                const highlightDiff = (val1: string, val2: string) => {
                                    if (!val1 || !val2) return false;
                                    return val1.trim().toLowerCase() !== val2.trim().toLowerCase();
                                };

                                const diffMarca = highlightDiff(item.marca_catalogo, item.marca_proveedor);
                                const diffModelo = highlightDiff(item.modelo_catalogo, item.sku_proveedor);
                                const diffCodigo = highlightDiff(item.codigo_universal, item.codigo_barra);

                                const bgRow1 = isAceptado ? 'bg-[var(--ok)]/10/40' : isRechazado ? 'bg-[var(--bg)] opacity-40' : 'bg-[var(--bg)]/40 hover:bg-[var(--surface-2)]/50';
                                const bgRow2 = isAceptado ? 'bg-emerald-100/40' : isRechazado ? 'bg-[var(--surface-2)] opacity-40' : 'bg-[var(--accent)]/10/20 hover:bg-[var(--accent)]/10/40';

                                return (
                                    <React.Fragment key={item.fila_num}>
                                        {/* FILA 1: CATÁLOGO */}
                                        <tr className={`${bgRow1} border-t-2 border-[var(--border)] transition-colors`}>
                                            <td className="py-3 px-4 border-r border-[var(--border)] text-center align-middle">
                                                <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest bg-[var(--surface)] px-2 py-1 rounded shadow-sm border border-[var(--border)]">Catálogo</span>
                                            </td>
                                            <td className="py-3 px-4 align-middle">
                                                <p className="font-bold text-[var(--text)] whitespace-normal line-clamp-2" title={item.nombre_catalogo}>{item.nombre_catalogo}</p>
                                            </td>
                                            <td className="py-3 px-4 align-middle">
                                                <p className={`font-semibold ${diffMarca ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]'}`}>{item.marca_catalogo || '—'}</p>
                                            </td>
                                            <td className="py-3 px-4 align-middle">
                                                <p className={`font-mono text-xs ${diffModelo ? 'text-[var(--warn)] font-bold' : 'text-[var(--text-muted)]'}`}>{item.modelo_catalogo || '—'}</p>
                                            </td>
                                            <td className="py-3 px-4 align-middle">
                                                <p className={`font-mono text-xs ${diffCodigo ? 'text-[var(--warn)] font-bold' : 'text-[var(--text-muted)]'}`}>{item.codigo_universal || '—'}</p>
                                            </td>
                                            
                                            {/* BOTONES: Hacen rowSpan=2 para abarcar ambas filas */}
                                            <td rowSpan={2} className="py-3 px-4 align-middle bg-[var(--surface)] border-l border-[var(--border)]">
                                                <div className="flex flex-col gap-2 justify-center w-full">
                                                    {isAceptado ? (
                                                        <span className="text-[var(--ok)] font-bold text-[11px] flex items-center justify-center gap-1.5 bg-emerald-100 border border-[var(--ok)]/30 py-2 rounded-lg"><Check className="w-4 h-4" /> Vinculado</span>
                                                    ) : isRechazado ? (
                                                        <span className="text-[var(--text-muted)] font-bold text-[11px] flex items-center justify-center gap-1.5 bg-[var(--surface-2)] border border-[var(--border)] py-2 rounded-lg"><X className="w-4 h-4" /> Ignorado</span>
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={() => handleAceptarUno(item)}
                                                                className="w-full py-2 bg-emerald-100 hover:bg-emerald-200 border border-[var(--ok)]/30 text-emerald-800 rounded-lg font-bold text-[11px] transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                                            >
                                                                <Check className="w-3.5 h-3.5" /> Aceptar
                                                            </button>
                                                            <button
                                                                onClick={() => setRechazados(prev => new Set([...prev, item.fila_num]))}
                                                                className="w-full py-2 bg-[var(--surface)] hover:bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg font-bold text-[11px] transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                                            >
                                                                <X className="w-3.5 h-3.5" /> Ignorar
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>

                                        {/* FILA 2: PROVEEDOR */}
                                        <tr className={`${bgRow2} transition-colors`}>
                                            <td className="py-3 px-4 border-r border-[var(--border)] text-center align-middle">
                                                <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest bg-[var(--surface)] px-2 py-1 rounded shadow-sm border border-indigo-100">{proveedor}</span>
                                            </td>
                                            <td className="py-3 px-4 align-middle">
                                                <p className="font-medium text-[var(--text-muted)] whitespace-normal line-clamp-2" title={item.descripcion_proveedor}>{item.descripcion_proveedor}</p>
                                                <div className="mt-1.5 flex items-center gap-3">
                                                    <span className="px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[10px] font-mono text-[var(--text-muted)] shadow-sm">Dist: <b>{fmtMx(item.dist)}</b></span>
                                                    <span className="px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[10px] font-mono text-[var(--text-muted)] shadow-sm">Men: <b>{fmtMx(item.menudeo)}</b></span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 align-middle">
                                                <p className={`font-semibold ${diffMarca ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]'}`}>{item.marca_proveedor || '—'}</p>
                                            </td>
                                            <td className="py-3 px-4 align-middle">
                                                <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${diffModelo ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-[var(--surface-2)] text-[var(--text)]'}`}>{item.sku_proveedor || '—'}</span>
                                            </td>
                                            <td className="py-3 px-4 align-middle">
                                                <p className={`font-mono text-xs ${diffCodigo ? 'font-bold text-[var(--warn)]' : 'text-[var(--text-muted)]'}`}>{item.codigo_barra || '—'}</p>
                                            </td>
                                        </tr>
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
