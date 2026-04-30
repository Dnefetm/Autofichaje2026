'use client';
import { useState } from 'react';
import { Check, Loader2, ListChecks, CheckSquare } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function PriceConfirmationPanelClient({ importacionId, proveedor, costos }: { importacionId: string, proveedor: string, costos: any[] }) {
    const [tab, setTab] = useState<'individual' | 'lote' | 'todos'>('individual');
    const [loading, setLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const router = useRouter();

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(costos.map(c => c.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelectOne = (id: string, checked: boolean) => {
        const newSet = new Set(selectedIds);
        if (checked) newSet.add(id);
        else newSet.delete(id);
        setSelectedIds(newSet);
    };

    const handleConfirm = async () => {
        setLoading(true);
        try {
            const body = {
                importacion_id: importacionId,
                proveedor,
                modo: tab,
                ids: tab === 'individual' ? Array.from(selectedIds) : null
            };

            const res = await fetch('/api/precios/confirmar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (res.ok) {
                alert(`¡Precios confirmados con éxito!`);
                router.push(`/precios/${encodeURIComponent(proveedor)}/historial`);
            } else {
                alert('Error al confirmar precios');
            }
        } catch (e) {
            alert('Error de red');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200">
            <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between bg-slate-50">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 flex items-center">
                        <CheckSquare className="w-5 h-5 mr-2 text-indigo-600" /> Confirmar Costos
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">Lote: <span className="font-mono bg-slate-200 px-1 py-0.5 rounded text-xs">{importacionId}</span></p>
                </div>
                <div className="flex bg-slate-200 p-1 rounded-lg">
                    <button onClick={() => setTab('individual')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'individual' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-600 hover:text-slate-900'}`}>Individual</button>
                    <button onClick={() => setTab('lote')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'lote' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-600 hover:text-slate-900'}`}>Lote de 200</button>
                    <button onClick={() => setTab('todos')} className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'todos' ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-600 hover:text-slate-900'}`}>Confirmar Todos</button>
                </div>
            </div>
            
            <div className="p-0">
                {tab === 'individual' && (
                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                        <table className="min-w-full divide-y divide-slate-200">
                            <thead className="bg-slate-50 sticky top-0 shadow-sm">
                                <tr>
                                    <th className="px-4 py-3 text-left w-10">
                                        <input 
                                            type="checkbox" 
                                            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                            onChange={e => handleSelectAll(e.target.checked)}
                                            checked={selectedIds.size === costos.length && costos.length > 0}
                                        />
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Artículo ID</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Modelo</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Tipo Costo</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Valor</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-200">
                                {costos.map(c => (
                                    <tr key={c.id} className="hover:bg-indigo-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                            <input 
                                                type="checkbox" 
                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                checked={selectedIds.has(c.id)}
                                                onChange={e => handleSelectOne(c.id, e.target.checked)}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm font-mono text-slate-500">{c.articulo_id?.substring(0,8)}...</td>
                                        <td className="px-4 py-3 text-sm font-medium text-slate-900">{c.modelo_excel}</td>
                                        <td className="px-4 py-3 text-sm text-slate-500"><span className="bg-slate-100 px-2 py-1 rounded text-xs">{c.tipo_costo}</span></td>
                                        <td className="px-4 py-3 text-sm font-medium text-emerald-600">{Number(c.valor).toLocaleString()} {c.moneda}</td>
                                    </tr>
                                ))}
                                {costos.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-4 py-12 text-center text-slate-500">No hay costos listos para confirmar.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
                {tab === 'lote' && (
                    <div className="text-center py-20 px-6 text-slate-600">
                        <ListChecks className="w-12 h-12 mx-auto text-indigo-200 mb-4" />
                        <h3 className="text-lg font-medium text-slate-900 mb-2">Confirmación por Lotes</h3>
                        <p>Al confirmar, se procesarán automáticamente los próximos <strong>200 artículos</strong> con matching exacto que estén pendientes de publicación.</p>
                    </div>
                )}
                {tab === 'todos' && (
                    <div className="text-center py-20 px-6 text-slate-600">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckSquare className="w-8 h-8 text-red-600" />
                        </div>
                        <h3 className="text-lg font-medium text-slate-900 mb-2">Confirmación Total</h3>
                        <p className="max-w-md mx-auto">Esta acción marcará como confirmados <strong>todos ({costos.length})</strong> los costos resueltos de esta importación.</p>
                    </div>
                )}
            </div>

            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex justify-between items-center">
                <div className="text-sm text-slate-500">
                    {tab === 'individual' ? `${selectedIds.size} seleccionados de ${costos.length}` : ''}
                </div>
                <button 
                    onClick={handleConfirm}
                    disabled={loading || (tab === 'individual' && selectedIds.size === 0)}
                    className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-medium shadow-sm hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                    {tab === 'lote' ? 'Confirmar Lote 200' : tab === 'todos' ? 'Confirmar Todos' : `Confirmar (${selectedIds.size})`}
                </button>
            </div>
        </div>
    );
}
