"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, DollarSign, CheckSquare, Square, AlertCircle, RefreshCw } from 'lucide-react';

export default function AuditoriaPricingPage() {
    const [drafts, setDrafts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [approving, setApproving] = useState(false);

    useEffect(() => {
        loadDrafts();
    }, []);

    const loadDrafts = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('publication_pricing_drafts')
            .select(
                *,
                publicacion:publicaciones_externas(
                    id, titulo, precio_venta, sku_fabricante, category_id,
                    marketplace:marketplace_configs(account_name)
                )
            )
            .eq('pricing_review_status', 'pending');
        setDrafts(data || []);
        setSelected(new Set());
        setLoading(false);
    };

    const toggleSelect = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const toggleAll = () => {
        if (selected.size === drafts.length) setSelected(new Set());
        else setSelected(new Set(drafts.map(d => d.publicacion_id)));
    };

    const handleApproveSelected = async () => {
        if (selected.size === 0) return;
        setApproving(true);
        try {
            const res = await fetch('/api/pricing/approve-drafts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicaciones: Array.from(selected) })
            });
            if (!res.ok) throw new Error('Error al aprobar');
            await loadDrafts();
        } catch (err) {
            console.error(err);
            alert('Error aprobando');
        } finally {
            setApproving(false);
        }
    };

    if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <DollarSign className="w-6 h-6 text-indigo-600" /> Auditoría de Precios
                    </h1>
                    <p className="text-sm text-slate-500">Publicaciones y combos pendientes de validación ({drafts.length})</p>
                </div>
                <div className="flex gap-3">
                    <button onClick={loadDrafts} className="px-3 py-2 bg-white border border-slate-200 rounded shadow-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2 text-sm font-semibold">
                        <RefreshCw className="w-4 h-4" /> Recargar
                    </button>
                    <button 
                        disabled={selected.size === 0 || approving}
                        onClick={handleApproveSelected}
                        className="px-4 py-2 bg-indigo-600 text-white rounded shadow-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2 text-sm font-bold"
                    >
                        {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckSquare className="w-4 h-4" />}
                        Aprobar Seleccionados ({selected.size})
                    </button>
                </div>
            </div>

            {drafts.length === 0 ? (
                <div className="bg-white p-10 rounded-xl border border-slate-200 text-center text-slate-500 flex flex-col items-center">
                    <CheckSquare className="w-10 h-10 text-green-400 mb-3" />
                    <p className="font-bold text-slate-700">¡Todo al día!</p>
                    <p className="text-sm">No hay precios pendientes de aprobación.</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                            <tr>
                                <th className="px-4 py-3 w-10">
                                    <button onClick={toggleAll}>
                                        {selected.size === drafts.length ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4" />}
                                    </button>
                                </th>
                                <th className="px-4 py-3">Publicación</th>
                                <th className="px-4 py-3">Precio Actual</th>
                                <th className="px-4 py-3 text-amber-700">Precio Sugerido</th>
                                <th className="px-4 py-3">Variación</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {drafts.map(d => {
                                const cur = d.publicacion.precio_venta || 0;
                                const nxt = d.draft_price;
                                const pct = cur > 0 ? ((nxt - cur) / cur) * 100 : 0;
                                const isUp = pct > 0;
                                return (
                                    <tr key={d.publicacion_id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-3">
                                            <button onClick={() => toggleSelect(d.publicacion_id)}>
                                                {selected.has(d.publicacion_id) ? <CheckSquare className="w-4 h-4 text-indigo-600" /> : <Square className="w-4 h-4 text-slate-300" />}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="font-semibold text-slate-800 line-clamp-1" title={d.publicacion.titulo}>{d.publicacion.titulo}</p>
                                            <p className="text-xs text-slate-500">SKU: {d.publicacion.sku_fabricante} • {d.publicacion.marketplace?.account_name}</p>
                                        </td>
                                        <td className="px-4 py-3 text-slate-600 font-medium"></td>
                                        <td className="px-4 py-3 font-bold text-amber-700"></td>
                                        <td className="px-4 py-3">
                                            {cur > 0 && pct !== 0 ? (
                                                <span className={inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-bold }>
                                                    {isUp ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%
                                                </span>
                                            ) : (
                                                <span className="text-slate-400 text-xs">-</span>
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
