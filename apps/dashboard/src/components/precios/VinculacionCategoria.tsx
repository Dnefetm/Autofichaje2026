'use client';
import { useState } from 'react';
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
    // Artículo del catálogo interno
    articulo_id: string;
    nombre_catalogo: string;
    marca_catalogo: string;
    modelo_catalogo: string;
    codigo_universal: string;
}

interface Props {
    categoria: string;
    titulo: string;
    descripcion: string;
    color: 'emerald' | 'amber' | 'blue';
    items: MatchItem[];
    proveedor: string;
}

const fmtMx = (n: number) => n > 0 ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—';

export function VinculacionCategoria({ categoria, titulo, descripcion, color, items, proveedor }: Props) {
    const [expandido, setExpandido] = useState(true);
    const [aceptando, setAceptando] = useState(false);
    const [aceptados, setAceptados] = useState<Set<number>>(new Set());
    const [rechazados, setRechazados] = useState<Set<number>>(new Set());
    const router = useRouter();

    const colorMap = {
        emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', btn: 'bg-emerald-600 hover:bg-emerald-700 text-white', title: 'text-emerald-800' },
        amber: { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', btn: 'bg-amber-500 hover:bg-amber-600 text-white', title: 'text-amber-800' },
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
            const data = await res.json();
            if (res.ok && data.ok) {
                setAceptados(new Set(items.map(i => i.fila_num)));
                router.refresh();
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
            }
        } catch {
            alert('Error de red');
        }
    };

    return (
        <div className={`rounded-2xl border ${c.border} overflow-hidden shadow-sm mb-6`}>
            {/* Header de categoría */}
            <div className={`${c.bg} px-6 py-4 flex items-center justify-between`}>
                <div className="flex items-center gap-3">
                    <button onClick={() => setExpandido(!expandido)} className="text-slate-500 hover:text-slate-700">
                        {expandido ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <div>
                        <h3 className={`font-bold text-base ${c.title}`}>{titulo}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{descripcion}</p>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${c.badge}`}>
                        {pendientes.length} pendientes · {aceptados.size} aceptados · {rechazados.size} ignorados
                    </span>
                </div>
                {pendientes.length > 0 && (
                    <button
                        onClick={handleAceptarTodos}
                        disabled={aceptando}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors shadow-sm ${c.btn} disabled:opacity-50`}
                    >
                        {aceptando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Aceptar todos ({pendientes.length})
                    </button>
                )}
            </div>

            {/* Tabla con diseño de filas apiladas (Top/Bottom) por ítem */}
            {expandido && (
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                            <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                <th className="py-3 px-4 w-[120px] text-center bg-slate-100">Origen</th>
                                <th className="py-3 px-4 text-left w-[40%]">Descripción / Nombre</th>
                                <th className="py-3 px-4 text-left w-[15%]">Marca</th>
                                <th className="py-3 px-4 text-left w-[15%]">Modelo / Clave</th>
                                <th className="py-3 px-4 text-left w-[15%]">Cód. Barras</th>
                                <th className="py-3 px-4 text-center w-[150px]">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y-2 divide-slate-200 bg-white">
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

                                return (
                                    <tr key={item.fila_num} className={`${isAceptado ? 'bg-emerald-50/40' : isRechazado ? 'bg-slate-50 opacity-40' : 'hover:bg-slate-50/30'}`}>
                                        <td colSpan={6} className="p-0">
                                            <div className="grid grid-cols-[120px_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_150px] items-stretch">
                                                
                                                {/* ---- FILA 1: TU CATÁLOGO ---- */}
                                                <div className="py-2.5 px-4 flex items-center justify-center bg-slate-50 border-b border-r border-slate-100">
                                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Catálogo</span>
                                                </div>
                                                <div className="py-2.5 px-4 border-b border-slate-100 flex items-center">
                                                    <p className="font-semibold text-slate-800 line-clamp-1" title={item.nombre_catalogo}>{item.nombre_catalogo}</p>
                                                </div>
                                                <div className="py-2.5 px-4 border-b border-slate-100 flex items-center">
                                                    <p className={`font-semibold ${diffMarca ? 'text-amber-600' : 'text-slate-700'}`}>{item.marca_catalogo || '—'}</p>
                                                </div>
                                                <div className="py-2.5 px-4 border-b border-slate-100 flex items-center">
                                                    <p className={`font-mono text-[11px] ${diffModelo ? 'text-amber-600' : 'text-slate-600'}`}>{item.modelo_catalogo || '—'}</p>
                                                </div>
                                                <div className="py-2.5 px-4 border-b border-slate-100 flex items-center">
                                                    <p className={`font-mono text-[11px] ${diffCodigo ? 'text-amber-600' : 'text-slate-600'}`}>{item.codigo_universal || '—'}</p>
                                                </div>
                                                
                                                {/* BOTONES DE ACCIÓN (Ocupan ambas filas visualmente con row-span o flex vertical) */}
                                                <div className="px-4 py-3 flex flex-col justify-center items-center border-l border-slate-100" style={{ gridRow: 'span 2' }}>
                                                    {isAceptado ? (
                                                        <span className="text-emerald-600 font-bold text-[11px] flex items-center gap-1 bg-emerald-50 px-2.5 py-1.5 rounded-lg"><Check className="w-3.5 h-3.5" /> Vinculado</span>
                                                    ) : isRechazado ? (
                                                        <span className="text-slate-500 font-bold text-[11px] flex items-center gap-1 bg-slate-100 px-2.5 py-1.5 rounded-lg"><X className="w-3.5 h-3.5" /> Ignorado</span>
                                                    ) : (
                                                        <div className="flex flex-col gap-1.5 w-full">
                                                            <button
                                                                onClick={() => handleAceptarUno(item)}
                                                                className="w-full py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded-lg font-bold text-[11px] transition-colors flex items-center justify-center gap-1"
                                                            >
                                                                <Check className="w-3 h-3" /> Aceptar
                                                            </button>
                                                            <button
                                                                onClick={() => setRechazados(prev => new Set([...prev, item.fila_num]))}
                                                                className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg font-bold text-[11px] transition-colors flex items-center justify-center gap-1"
                                                            >
                                                                <X className="w-3 h-3" /> Ignorar
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* ---- FILA 2: PROVEEDOR ---- */}
                                                <div className="py-2.5 px-4 flex flex-col items-center justify-center bg-indigo-50/50 border-r border-slate-100">
                                                    <span className="text-[10px] font-black text-indigo-700 uppercase tracking-widest">{proveedor}</span>
                                                    <span className="text-[9px] text-indigo-400 mt-0.5">NUEVO LOTE</span>
                                                </div>
                                                <div className="py-2.5 px-4 flex items-center justify-between">
                                                    <p className="text-slate-600 line-clamp-1 mr-2" title={item.descripcion_proveedor}>{item.descripcion_proveedor}</p>
                                                    <div className="shrink-0 text-[10px] text-slate-400 flex items-center gap-2 font-mono">
                                                        <span>Dist: <b className="text-slate-600">{fmtMx(item.dist)}</b></span>
                                                        <span>Men: <b className="text-slate-600">{fmtMx(item.menudeo)}</b></span>
                                                    </div>
                                                </div>
                                                <div className="py-2.5 px-4 flex items-center">
                                                    <p className={`font-semibold ${diffMarca ? 'text-amber-600' : 'text-slate-700'}`}>{item.marca_proveedor || '—'}</p>
                                                </div>
                                                <div className="py-2.5 px-4 flex items-center">
                                                    <span className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${diffModelo ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-800'}`}>{item.sku_proveedor || '—'}</span>
                                                </div>
                                                <div className="py-2.5 px-4 flex items-center">
                                                    <p className={`font-mono text-[11px] ${diffCodigo ? 'font-bold text-amber-600' : 'text-slate-600'}`}>{item.codigo_barra || '—'}</p>
                                                </div>

                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
