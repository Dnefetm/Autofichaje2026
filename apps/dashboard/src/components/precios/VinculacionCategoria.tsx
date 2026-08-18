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
    sku_catalogo: string;
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

            {/* Tabla */}
            {expandido && (
                <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0 z-10">
                            <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                <th className="py-2.5 px-4 text-left" colSpan={2}>← Proveedor (Urrea)</th>
                                <th className="py-2.5 px-4 text-right">Dist.</th>
                                <th className="py-2.5 px-4 text-right">Menudeo</th>
                                <th className="py-2.5 px-2 text-center text-slate-200">|</th>
                                <th className="py-2.5 px-4 text-left" colSpan={2}>Tu Catálogo Interno →</th>
                                <th className="py-2.5 px-4 text-center">Acción</th>
                            </tr>
                            <tr className="text-[10px] font-semibold text-slate-400 border-b border-slate-100 bg-slate-50">
                                <th className="pb-2 px-4 text-left">Clave / Descripción</th>
                                <th className="pb-2 px-4 text-left">Marca · Código de Barras</th>
                                <th className="pb-2 px-4 text-right"></th>
                                <th className="pb-2 px-4 text-right"></th>
                                <th className="pb-2 px-2"></th>
                                <th className="pb-2 px-4 text-left">Nombre / SKU</th>
                                <th className="pb-2 px-4 text-left">Marca · Modelo · Cód.Universal</th>
                                <th className="pb-2 px-4"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {items.map((item) => {
                                const isAceptado = aceptados.has(item.fila_num);
                                const isRechazado = rechazados.has(item.fila_num);
                                return (
                                    <tr key={item.fila_num} className={`${isAceptado ? 'bg-emerald-50/40' : isRechazado ? 'bg-slate-50 opacity-50' : 'hover:bg-slate-50/50'}`}>
                                        {/* Lado Proveedor */}
                                        <td className="py-2.5 px-4 max-w-[200px]">
                                            <span className="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">{item.sku_proveedor}</span>
                                            <p className="text-slate-500 mt-0.5 line-clamp-2 text-[11px]">{item.descripcion_proveedor}</p>
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <p className="font-semibold text-slate-700">{item.marca_proveedor}</p>
                                            <p className="font-mono text-slate-400 text-[10px]">{item.codigo_barra || '—'}</p>
                                        </td>
                                        <td className="py-2.5 px-4 text-right font-bold text-slate-800">{fmtMx(item.dist)}</td>
                                        <td className="py-2.5 px-4 text-right text-slate-600">{fmtMx(item.menudeo)}</td>

                                        {/* Divisor */}
                                        <td className="py-2.5 px-2 text-center text-slate-200 font-light text-lg">│</td>

                                        {/* Lado Catálogo */}
                                        <td className="py-2.5 px-4 max-w-[200px]">
                                            <p className="font-semibold text-slate-800 line-clamp-2 text-[11px]">{item.nombre_catalogo}</p>
                                            <p className="font-mono text-slate-400 text-[10px]">SKU: {item.sku_catalogo || '—'}</p>
                                        </td>
                                        <td className="py-2.5 px-4">
                                            <p className="font-semibold text-slate-700">{item.marca_catalogo}</p>
                                            <p className="text-slate-500 text-[10px]">Modelo: {item.modelo_catalogo || '—'}</p>
                                            <p className="font-mono text-slate-400 text-[10px]">{item.codigo_universal}</p>
                                        </td>

                                        {/* Acción */}
                                        <td className="py-2.5 px-4 text-center">
                                            {isAceptado ? (
                                                <span className="text-emerald-600 font-bold text-[10px] flex items-center justify-center gap-1"><Check className="w-3 h-3" /> Vinculado</span>
                                            ) : isRechazado ? (
                                                <span className="text-slate-400 text-[10px] flex items-center justify-center gap-1"><X className="w-3 h-3" /> Ignorado</span>
                                            ) : (
                                                <div className="flex items-center justify-center gap-1">
                                                    <button
                                                        onClick={() => handleAceptarUno(item)}
                                                        className="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg font-bold text-[10px] transition-colors flex items-center gap-0.5"
                                                    >
                                                        <Check className="w-2.5 h-2.5" /> Aceptar
                                                    </button>
                                                    <button
                                                        onClick={() => setRechazados(prev => new Set([...prev, item.fila_num]))}
                                                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg font-bold text-[10px] transition-colors flex items-center gap-0.5"
                                                    >
                                                        <X className="w-2.5 h-2.5" /> Ignorar
                                                    </button>
                                                </div>
                                            )}
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
