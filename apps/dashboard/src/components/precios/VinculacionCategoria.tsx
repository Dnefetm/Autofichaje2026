'use client';
import { useState } from 'react';
import { Check, X, ChevronDown, ChevronUp, CheckSquare, Loader2 } from 'lucide-react';
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
    sub: number;
    mayoreo: number;
}

interface Props {
    categoria: string;
    titulo: string;
    descripcion: string;
    color: 'emerald' | 'amber' | 'blue';
    items: MatchItem[];
    proveedor: string;
    onAccepted?: (items: MatchItem[]) => void;
}

const fmtMx = (n: number) => n > 0 ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—';

export function VinculacionCategoria({ onAccepted, categoria, titulo, descripcion, color, items, proveedor }: Props) {
    const [expandido, setExpandido] = useState(true);
    const [aceptando, setAceptando] = useState(false);
    const [aceptados, setAceptados] = useState<Set<number>>(new Set());
    const [rechazados, setRechazados] = useState<Set<number>>(new Set());
    const router = useRouter();

    const pendientes = items.filter(i => !aceptados.has(i.fila_num) && !rechazados.has(i.fila_num));
    if (pendientes.length === 0) return null;

    const colorClasses = {
        emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        amber: 'bg-amber-50 border-amber-200 text-amber-800',
        blue: 'bg-blue-50 border-blue-200 text-blue-800'
    };
    
    const iconColor = {
        emerald: 'text-emerald-500',
        amber: 'text-amber-500',
        blue: 'text-blue-500'
    };

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

    const handleRechazarUno = (item: MatchItem) => {
        setRechazados(prev => new Set([...prev, item.fila_num]));
    };

    return (
        <div className={`rounded-2xl border overflow-hidden shadow-sm transition-all ${colorClasses[color]}`}>
            <div className="px-6 py-4 border-b flex items-center justify-between bg-white/50 backdrop-blur-sm">
                <div>
                    <h3 className="font-bold flex items-center gap-2 text-[15px]">
                        <span className="bg-white px-2 py-0.5 rounded shadow-sm border border-slate-100 text-xs tabular-nums">
                            {pendientes.length}
                        </span> 
                        {titulo}
                    </h3>
                    <p className="text-xs opacity-75 mt-1">{descripcion}</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleAceptarTodos}
                        disabled={aceptando}
                        className="px-4 py-2 bg-white rounded-lg shadow-sm border border-slate-200 text-xs font-bold flex items-center gap-2 hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                        {aceptando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className={`w-4 h-4 ${iconColor[color]}`} />}
                        Aceptar Todos
                    </button>
                    <button onClick={() => setExpandido(!expandido)} className="p-2 hover:bg-white/50 rounded-lg transition-colors">
                        {expandido ? <ChevronUp className="w-5 h-5 opacity-50" /> : <ChevronDown className="w-5 h-5 opacity-50" />}
                    </button>
                </div>
            </div>

            {expandido && (
                <div className="bg-white">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-slate-50 border-b border-slate-100">
                                <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                    <th className="py-3 px-4">Acción</th>
                                    <th className="py-3 px-4">Art. Catálogo Interno</th>
                                    <th className="py-3 px-4">Info Proveedor Excel</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {pendientes.map(item => (
                                    <tr key={item.fila_num} className="hover:bg-slate-50/50 group transition-colors">
                                        <td className="py-3 px-4 align-middle w-24">
                                            <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => handleAceptarUno(item)} title="Vincular" className="p-1.5 rounded-md hover:bg-emerald-100 text-emerald-600 transition-colors border border-transparent hover:border-emerald-200">
                                                    <Check className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => handleRechazarUno(item)} title="Rechazar coincidencia" className="p-1.5 rounded-md hover:bg-red-100 text-red-600 transition-colors border border-transparent hover:border-red-200">
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 align-middle">
                                            <div className="flex gap-3 items-center">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[10px] shadow-sm border ${colorClasses[color]}`}>
                                                    {item.marca_catalogo?.slice(0, 2).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-slate-800 line-clamp-1" title={item.nombre_catalogo}>{item.nombre_catalogo}</p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-slate-500 font-medium">Mod: {item.modelo_catalogo || '—'}</span>
                                                        <span className="text-slate-300">•</span>
                                                        <span className="text-slate-500 font-mono">EAN: {item.codigo_universal || '—'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 align-middle border-l border-slate-50 bg-slate-50/30">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono font-bold text-slate-700 bg-white px-1.5 py-0.5 rounded shadow-sm border border-slate-200">
                                                        {item.sku_proveedor}
                                                    </span>
                                                    <span className="font-mono text-slate-500 text-[10px]">EAN Excel: {item.codigo_barra || '—'}</span>
                                                </div>
                                                <p className="font-medium whitespace-normal line-clamp-2 text-slate-600" title={item.descripcion_proveedor}>{item.descripcion_proveedor}</p>
                                                <div className="mt-1 flex items-center gap-3">
                                                    <span className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono text-slate-500 shadow-sm">Dist: <b className="text-slate-700">{fmtMx(item.dist)}</b></span>
                                                    <span className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-mono text-slate-500 shadow-sm">Men: <b className="text-slate-700">{fmtMx(item.menudeo)}</b></span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}