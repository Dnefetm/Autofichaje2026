"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { DollarSign, Percent, Save, Loader2, Trash2, Plus, AlertCircle, RefreshCw } from 'lucide-react';

export default function PricingSettingsPage() {
    const [rules, setRules] = useState<any[]>([]);
    const [commissions, setCommissions] = useState<any[]>([]);
    const [marketplaces, setMarketplaces] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    // Formulario de nueva comisión
    const [newCat, setNewCat] = useState('');
    const [newPct, setNewPct] = useState('');
    const [newFee, setNewFee] = useState('299.00');

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        setLoading(true);
        try {
            const { data: mkp } = await supabase.from('marketplace_configs').select('id, account_name').eq('is_active', true);
            setMarketplaces(mkp || []);

            const res = await fetch('/api/settings/pricing');
            const data = await res.json();
            setRules(data.rules || []);
            setCommissions(data.commissions || []);
        } finally {
            setLoading(false);
        }
    }

    async function saveGlobalMargin(marketplace_id: string, margin: number, existingRuleId?: string) {
        setSaving(true);
        try {
            await fetch('/api/settings/pricing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'global_rule',
                    data: { id: existingRuleId, margin, marketplace_id }
                })
            });
            await loadData();
        } finally {
            setSaving(false);
        }
    }

    async function addCommission(marketplace_id: string) {
        if (!newCat || !newPct) return;
        setSaving(true);
        try {
            await fetch('/api/settings/pricing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'category_commission',
                    data: { 
                        marketplace_id, 
                        category_id: newCat.trim(), 
                        commission_percentage: parseFloat(newPct),
                        fixed_fee_threshold: parseFloat(newFee)
                    }
                })
            });
            setNewCat(''); setNewPct('');
            await loadData();
        } finally {
            setSaving(false);
        }
    }

    async function deleteCommission(id: string) {
        setSaving(true);
        try {
            await fetch('/api/settings/pricing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'delete_category', data: { id } })
            });
            await loadData();
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-10 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

    const mkp = marketplaces[0]; // Simplificación para 1 tienda (Mercado Libre principal)
    if (!mkp) return <div className="p-10 text-center">No hay tienda MeLi vinculada.</div>;

    const rule = rules.find(r => r.marketplace_id === mkp.id);
    const mMargin = rule ? rule.value : 20;

    return (
        <div className="max-w-4xl mx-auto space-y-8 p-6 animate-in fade-in slide-in-from-bottom-4">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Estrategia Global de Precios</h2>
                <p className="text-slate-500 text-sm mt-1">Configura el motor matemático base para las publicaciones de la tienda <strong>{mkp.account_name}</strong>.</p>
            </div>

            {/* Margen Global */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 shrink-0">
                        <Percent className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                        <h3 className="font-bold text-slate-900 text-lg">Margen Global Deseado</h3>
                        <p className="text-sm text-slate-500 mb-4">
                            Este es el % de ganancia neta que el sistema intentará asegurar en cada producto por defecto. 
                            Si un producto no tiene margen custom (override), usará este.
                        </p>
                        
                        <div className="flex items-center gap-3">
                            <input 
                                type="number" 
                                id="global_margin"
                                defaultValue={mMargin} 
                                className="w-24 border-2 border-indigo-200 rounded-lg px-3 py-2 font-bold focus:border-indigo-500 outline-none"
                            />
                            <span className="font-bold text-slate-500">%</span>
                            <button 
                                onClick={() => {
                                    const val = (document.getElementById('global_margin') as HTMLInputElement).value;
                                    saveGlobalMargin(mkp.id, parseFloat(val), rule?.id);
                                }}
                                disabled={saving}
                                className="ml-4 px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Guardar Margen Global
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Comisiones por Categoría */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-slate-900">Comisiones por Categoría MeLi</h3>
                        <p className="text-xs text-slate-500">Mapea el cobro real de Mercado Libre según la categoría del producto (ej: MLB1234)</p>
                    </div>
                </div>
                
                <div className="p-6 space-y-4">
                    <div className="flex flex-wrap items-end gap-3 bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Categoría ID</label>
                            <input value={newCat} onChange={e=>setNewCat(e.target.value)} placeholder="Ej: MLM1234" className="w-32 border border-slate-300 rounded px-3 py-1.5 text-sm outline-none" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Comisión (%)</label>
                            <input type="number" value={newPct} onChange={e=>setNewPct(e.target.value)} placeholder="Ej: 15.5" className="w-28 border border-slate-300 rounded px-3 py-1.5 text-sm outline-none" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Costo Fijo si &lt; $N</label>
                            <input type="number" value={newFee} onChange={e=>setNewFee(e.target.value)} placeholder="299.00" className="w-28 border border-slate-300 rounded px-3 py-1.5 text-sm outline-none" />
                        </div>
                        <button onClick={() => addCommission(mkp.id)} disabled={saving} className="px-4 py-1.5 bg-slate-800 text-white text-sm font-bold rounded hover:bg-slate-900 transition-colors flex items-center gap-1 h-9">
                            <Plus className="w-4 h-4" /> Añadir
                        </button>
                    </div>

                    {commissions.length === 0 ? (
                        <div className="text-center py-6 text-slate-400 italic text-sm">
                            No hay comisiones específicas registradas. El motor asume 15% por defecto.
                        </div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase font-bold tracking-wider">
                                <tr>
                                    <th className="px-4 py-2 rounded-l-lg">Categoría</th>
                                    <th className="px-4 py-2">Comisión MeLi</th>
                                    <th className="px-4 py-2">Cobro Fijo Menores</th>
                                    <th className="px-4 py-2 text-right rounded-r-lg">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {commissions.map(c => (
                                    <tr key={c.id} className="hover:bg-slate-50">
                                        <td className="px-4 py-3 font-mono font-bold text-indigo-700">{c.category_id}</td>
                                        <td className="px-4 py-3 font-semibold text-slate-700">{c.commission_percentage}%</td>
                                        <td className="px-4 py-3 text-slate-500">Si precio &lt; ${c.fixed_fee_threshold}</td>
                                        <td className="px-4 py-3 text-right">
                                            <button onClick={() => deleteCommission(c.id)} className="text-rose-500 hover:bg-rose-50 p-1.5 rounded transition-colors" title="Eliminar">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
            
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                <p className="text-sm text-amber-800">
                    <strong>Nota:</strong> Modificar el Margen Global o las comisiones de categoría no recalcula inmediatamente todo el catálogo (por seguridad de cuota API). Los nuevos valores se usarán progresivamente conforme las publicaciones tengan actualizaciones de costo o stock, o si fuerzas un recálculo desde el dashboard de Fichas.
                </p>
            </div>
        </div>
    );
}
