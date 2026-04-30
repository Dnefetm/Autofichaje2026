'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Download, Check, Loader2 } from 'lucide-react';
import { usePricingFlowState } from '@/components/precios/flow/usePricingFlowState';

export function ClientDiffPanel({ importacion, proveedor, diffData }: { importacion: any, proveedor: string, diffData: any[] }) {
    const router = useRouter();
    const { mutate } = usePricingFlowState(proveedor);

    // Filter states
    const [activeChip, setActiveChip] = useState<'todos' | 'nuevo' | 'cambio' | 'ausente' | 'sin_cambio'>('todos');
    const [search, setSearch] = useState('');
    const [soloCambiosMayores, setSoloCambiosMayores] = useState(false);
    const [soloAumentos, setSoloAumentos] = useState(false);

    // Selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);

    // Counts for chips
    const stats = useMemo(() => {
        let nuevos = 0, cambios = 0, ausentes = 0, sinCambio = 0;
        diffData.forEach(d => {
            if (d.row_class === 'nuevo') nuevos++;
            else if (d.row_class === 'cambio') cambios++;
            else if (d.row_class === 'ausente') ausentes++;
            else if (d.row_class === 'sin_cambio') sinCambio++;
        });
        return { nuevos, cambios, ausentes, sinCambio };
    }, [diffData]);

    // Filtered data
    const filteredData = useMemo(() => {
        return diffData.filter(d => {
            if (activeChip !== 'todos' && d.row_class !== activeChip) return false;
            if (search) {
                const s = search.toLowerCase();
                if (!d.articulo_id?.toLowerCase().includes(s) && !d.modelo_excel?.toLowerCase().includes(s)) return false;
            }
            if (soloCambiosMayores && d.row_class === 'cambio') {
                if (Math.abs(d.delta_pct || 0) < 5) return false;
            }
            if (soloAumentos && d.row_class === 'cambio') {
                if ((d.delta_pct || 0) <= 0) return false;
            }
            return true;
        });
    }, [diffData, activeChip, search, soloCambiosMayores, soloAumentos]);

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            // Select all currently visible filtered items EXCEPT ausentes (they aren't confirmed, they are just missing)
            const newSet = new Set(selectedIds);
            filteredData.forEach(d => {
                if (d.row_class !== 'ausente' && d.id) newSet.add(d.id);
            });
            setSelectedIds(newSet);
        } else {
            const newSet = new Set(selectedIds);
            filteredData.forEach(d => {
                if (d.id) newSet.delete(d.id);
            });
            setSelectedIds(newSet);
        }
    };

    const handleSelectOne = (id: string, checked: boolean) => {
        const newSet = new Set(selectedIds);
        if (checked) newSet.add(id);
        else newSet.delete(id);
        setSelectedIds(newSet);
    };

    const handleApply = async (modo: 'seleccionados' | 'todo') => {
        const ids = modo === 'seleccionados' ? Array.from(selectedIds) : [];
        if (modo === 'seleccionados' && ids.length === 0) return;

        setLoading(true);
        try {
            const res = await fetch('/api/precios/confirmar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    importacion_id: importacion.id,
                    proveedor,
                    modo: modo === 'todo' ? 'todos' : 'individual',
                    ids
                })
            });
            if (res.ok) {
                await mutate();
                router.push(`/precios/${encodeURIComponent(proveedor)}/aplicar`);
            } else {
                alert('Error al confirmar');
                setLoading(false);
            }
        } catch (e) {
            alert('Error de red');
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full relative">
            <div className="flex-1 overflow-auto pb-24">
                {/* Header / Chips */}
                <div className="bg-white px-8 py-6 border-b border-slate-200 sticky top-0 z-20">
                    <h2 className="text-xl font-bold text-slate-900 mb-4">Auditoría de Precios</h2>
                    
                    <div className="flex flex-wrap gap-3 mb-6">
                        <button onClick={() => setActiveChip('todos')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'todos' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                            Todos ({diffData.length})
                        </button>
                        <button onClick={() => setActiveChip('nuevo')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'nuevo' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}>
                            +{stats.nuevos} Nuevos
                        </button>
                        <button onClick={() => setActiveChip('cambio')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'cambio' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>
                            Δ {stats.cambios} Cambios
                        </button>
                        <button onClick={() => setActiveChip('ausente')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'ausente' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}>
                            -{stats.ausentes} Ausentes
                        </button>
                        <button onClick={() => setActiveChip('sin_cambio')} className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${activeChip === 'sin_cambio' ? 'bg-slate-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                            {stats.sinCambio} Sin cambio
                        </button>
                    </div>

                    <div className="flex items-center gap-6 text-sm">
                        <div className="relative w-72">
                            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                            <input 
                                type="text" 
                                placeholder="Buscar SKU/modelo..." 
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="pl-9 pr-4 py-2 w-full border border-slate-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        <label className="flex items-center space-x-2 text-slate-700 cursor-pointer">
                            <input type="checkbox" checked={soloCambiosMayores} onChange={e => setSoloCambiosMayores(e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                            <span>Solo cambios &gt; 5%</span>
                        </label>
                        <label className="flex items-center space-x-2 text-slate-700 cursor-pointer">
                            <input type="checkbox" checked={soloAumentos} onChange={e => setSoloAumentos(e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                            <span>Solo aumentos</span>
                        </label>
                    </div>
                </div>

                {/* Table */}
                <div className="px-8 py-6">
                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="px-4 py-3 w-10 text-center">
                                        <input 
                                            type="checkbox" 
                                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                            onChange={e => handleSelectAll(e.target.checked)}
                                            checked={filteredData.length > 0 && filteredData.filter(d => d.row_class !== 'ausente').every(d => selectedIds.has(d.id))}
                                        />
                                    </th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">SKU</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">Modelo</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">Vigente</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">Nuevo</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">Δ $</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">Δ %</th>
                                    <th className="px-4 py-3 text-center font-medium text-slate-500 uppercase text-xs">Estado</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-200">
                                {filteredData.map(d => {
                                    const isAusente = d.row_class === 'ausente';
                                    const fmt = (val: number | null) => val !== null ? `$${val.toLocaleString()}` : '-';
                                    
                                    return (
                                        <tr key={d.id || `${d.articulo_id}-${d.tipo_costo}`} className={`hover:bg-slate-50 transition-colors ${isAusente ? 'opacity-60 bg-slate-50' : ''}`}>
                                            <td className="px-4 py-3 text-center">
                                                {!isAusente && (
                                                    <input 
                                                        type="checkbox" 
                                                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                        checked={selectedIds.has(d.id)}
                                                        onChange={e => handleSelectOne(d.id, e.target.checked)}
                                                    />
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-slate-500">{d.articulo_id?.substring(0,8)}</td>
                                            <td className={`px-4 py-3 font-medium ${isAusente ? 'line-through text-slate-500' : 'text-slate-900'}`}>{d.modelo_excel || d.modelo}</td>
                                            <td className="px-4 py-3 text-slate-500">{fmt(d.valor_anterior)}</td>
                                            <td className="px-4 py-3 font-medium text-slate-900">{isAusente ? '-' : fmt(d.valor)}</td>
                                            <td className={`px-4 py-3 font-medium ${d.delta_val && d.delta_val > 0 ? 'text-red-600' : d.delta_val && d.delta_val < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                {d.delta_val ? `${d.delta_val > 0 ? '+' : ''}${fmt(d.delta_val)}` : '-'}
                                            </td>
                                            <td className="px-4 py-3">
                                                {d.delta_pct !== null ? (
                                                    <span className={`px-2 py-1 rounded-md text-xs font-bold ${d.delta_pct > 0 ? 'bg-red-100 text-red-700' : d.delta_pct < 0 ? 'bg-emerald-100 text-emerald-700' : 'text-slate-400'}`}>
                                                        {d.delta_pct > 0 ? '+' : ''}{d.delta_pct.toFixed(1)}%
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                {d.row_class === 'nuevo' && <span className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-bold tracking-wide">NUEVO</span>}
                                                {d.row_class === 'cambio' && <span className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded text-xs font-bold tracking-wide">CAMBIO</span>}
                                                {d.row_class === 'ausente' && <span className="bg-amber-100 text-amber-800 px-2 py-1 rounded text-xs font-bold tracking-wide">AUSENTE</span>}
                                                {d.row_class === 'sin_cambio' && <span className="text-slate-400 text-xs">Mantener</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredData.length === 0 && (
                                    <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">No hay resultados para los filtros actuales.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Footer Fijo */}
            <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 flex justify-between items-center shadow-[0_-4px_6px_-1px_rgb(0,0,0,0.05)] z-30">
                <div className="text-sm text-slate-500 pl-4 font-medium">
                    {selectedIds.size} seleccionados de {stats.nuevos + stats.cambios + stats.sinCambio} válidos
                </div>
                <div className="flex items-center space-x-3 pr-4">
                    <button className="inline-flex items-center px-4 py-2 bg-white border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50 shadow-sm text-sm transition-colors">
                        <Download className="w-4 h-4 mr-2" /> Exportar diff
                    </button>
                    <button 
                        onClick={() => handleApply('seleccionados')}
                        disabled={loading || selectedIds.size === 0}
                        className="inline-flex items-center px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg font-medium hover:bg-indigo-200 shadow-sm text-sm transition-colors disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                        Aplicar {selectedIds.size} seleccionados
                    </button>
                    <button 
                        onClick={() => handleApply('todo')}
                        disabled={loading || (stats.nuevos + stats.cambios + stats.sinCambio) === 0}
                        className="inline-flex items-center px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 shadow-sm transition-colors disabled:opacity-50 text-base"
                    >
                        {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Check className="w-5 h-5 mr-2" />}
                        Aplicar todo el diff
                    </button>
                </div>
            </div>
        </div>
    );
}
