"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { DollarSign, Save, Loader2, Trash2, Plus, AlertCircle, Edit2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PricingSettingsPage() {
    const [rules, setRules] = useState<any[]>([]);
    const [marketplaces, setMarketplaces] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    const [isEditingRule, setIsEditingRule] = useState<any>(null);
    const [isCreatingRule, setIsCreatingRule] = useState(false);

    useEffect(() => { loadData(); }, []);

    async function loadData() {
        setLoading(true);
        try {
            const { data: mkp } = await supabase.from('marketplace_configs').select('id, account_name').eq('is_active', true);
            setMarketplaces(mkp || []);

            const res = await fetch('/api/settings/pricing');
            const data = await res.json();
            setRules(data.rules || []);
        } finally {
            setLoading(false);
        }
    }

    async function saveRule(ruleData: any) {
        setSaving(true);
        try {
            await fetch('/api/settings/pricing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'upsert_rule_v3',
                    data: ruleData
                })
            });
            setIsEditingRule(null);
            setIsCreatingRule(false);
            await loadData();
        } finally {
            setSaving(false);
        }
    }

    async function deleteRule(id: string) {
        if(!confirm("¿Seguro que deseas eliminar esta regla?")) return;
        setSaving(true);
        try {
            await fetch('/api/settings/pricing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'delete_rule_v3', data: { id } })
            });
            await loadData();
        } finally {
            setSaving(false);
        }
    }

    if (loading) return <div className="p-10 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;

    const RuleForm = ({ initialData, onCancel }: { initialData?: any, onCancel: () => void }) => {
        const [formData, setFormData] = useState(initialData || {
            name: '', priority: 100, is_active: true, cost_basis: 'menudeo', 
            margen_objetivo: 20, redondeo: '99', envio_fijo: 0,
            marca: '', category_id: '', articulo_id: ''
        });

        return (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-5 mt-4 space-y-4 shadow-sm animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-800">{initialData ? 'Editar Regla' : 'Nueva Regla V3'}</h4>
                    <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4"/></button>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="col-span-2">
                        <label className="block text-xs font-bold text-slate-500 mb-1">Nombre Descriptivo</label>
                        <input className="w-full border rounded px-3 py-1.5 text-sm" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} placeholder="Ej: Regla Global Base" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Prioridad (1=Alta)</label>
                        <input type="number" className="w-full border rounded px-3 py-1.5 text-sm" value={formData.priority} onChange={e=>setFormData({...formData, priority: parseInt(e.target.value)})} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Margen Objetivo (%)</label>
                        <input type="number" step="0.1" className="w-full border rounded px-3 py-1.5 text-sm" value={formData.margen_objetivo} onChange={e=>setFormData({...formData, margen_objetivo: parseFloat(e.target.value)})} />
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Filtro Marca (Opcional)</label>
                        <input className="w-full border rounded px-3 py-1.5 text-sm" value={formData.marca || ''} onChange={e=>setFormData({...formData, marca: e.target.value || null})} placeholder="Todas" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Filtro Categoría (Opcional)</label>
                        <input className="w-full border rounded px-3 py-1.5 text-sm" value={formData.category_id || ''} onChange={e=>setFormData({...formData, category_id: e.target.value || null})} placeholder="Todas" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Costo Base</label>
                        <select className="w-full border rounded px-3 py-1.5 text-sm" value={formData.cost_basis} onChange={e=>setFormData({...formData, cost_basis: e.target.value})}>
                            <option value="menudeo">Menudeo</option>
                            <option value="mayoreo">Mayoreo</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Redondeo</label>
                        <select className="w-full border rounded px-3 py-1.5 text-sm" value={formData.redondeo} onChange={e=>setFormData({...formData, redondeo: e.target.value})}>
                            <option value="none">Sin redondeo</option>
                            <option value="99">A .99</option>
                            <option value="00">A .00</option>
                        </select>
                    </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                    <button onClick={onCancel} className="px-4 py-1.5 rounded text-sm font-semibold text-slate-600 hover:bg-slate-200">Cancelar</button>
                    <button onClick={() => saveRule(formData)} disabled={saving || !formData.name} className="px-4 py-1.5 rounded text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>} Guardar Regla
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8 p-6 animate-in fade-in slide-in-from-bottom-4">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Motor de Precios V3 - Panel de Reglas</h2>
                <p className="text-slate-500 text-sm mt-1">
                    Las reglas operan en cascada. El sistema evaluará cada publicación contra estas reglas en orden de prioridad (1 = Máxima prioridad) y aplicará la primera que coincida exactamente con todos sus filtros.
                </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-slate-900">Reglas en Cascada</h3>
                        <p className="text-xs text-slate-500">Listado de reglas de cálculo activas.</p>
                    </div>
                    <button 
                        onClick={() => setIsCreatingRule(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded shadow-sm transition-colors"
                    >
                        <Plus className="w-4 h-4" /> Nueva Regla
                    </button>
                </div>
                
                <div className="p-6">
                    {isCreatingRule && <RuleForm onCancel={() => setIsCreatingRule(false)} />}

                    <div className="mt-4 flex flex-col gap-3">
                        {rules.map((rule) => (
                            <div key={rule.id} className="border border-slate-200 rounded-lg p-4 hover:border-indigo-300 transition-colors bg-white shadow-sm flex flex-col md:flex-row md:items-center gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px] font-bold border border-slate-200">
                                            #{rule.priority}
                                        </span>
                                        <h4 className="font-bold text-slate-800">{rule.name}</h4>
                                        {!rule.is_active && <span className="px-2 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded">INACTIVA</span>}
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-500 mt-2">
                                        {rule.marca && <span className="bg-indigo-50 text-indigo-700 px-1.5 rounded">Marca: {rule.marca}</span>}
                                        {rule.category_id && <span className="bg-indigo-50 text-indigo-700 px-1.5 rounded">Categoría: {rule.category_id}</span>}
                                        {!rule.marca && !rule.category_id && <span className="text-slate-400 italic">Global (Aplica a todo)</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-6 md:border-l md:border-slate-100 md:pl-6">
                                    <div className="text-center">
                                        <p className="text-[10px] uppercase text-slate-400 font-bold mb-0.5">Margen</p>
                                        <p className="font-bold text-slate-800 text-lg">{rule.margen_objetivo}%</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[10px] uppercase text-slate-400 font-bold mb-0.5">Costo</p>
                                        <p className="font-semibold text-slate-600 text-sm capitalize">{rule.cost_basis}</p>
                                    </div>
                                    <div className="flex gap-1 ml-2">
                                        <button onClick={() => setIsEditingRule(rule.id)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => deleteRule(rule.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                                {isEditingRule === rule.id && (
                                    <div className="w-full mt-4 border-t pt-4">
                                        <RuleForm initialData={rule} onCancel={() => setIsEditingRule(null)} />
                                    </div>
                                )}
                            </div>
                        ))}
                        {rules.length === 0 && !isCreatingRule && (
                            <div className="text-center py-8 text-slate-400 italic text-sm border-2 border-dashed border-slate-200 rounded-lg">
                                No hay reglas de precio configuradas. Las publicaciones arrojarán "no_rule".
                            </div>
                        )}
                    </div>
                </div>
            </div>
            
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-sky-600 shrink-0" />
                <div className="text-sm text-sky-800 space-y-1">
                    <p><strong>Arquitectura de V3:</strong></p>
                    <ul className="list-disc pl-4 text-[12px]">
                        <li>Las reglas se evalúan de menor a mayor prioridad (La prioridad 1 se evalúa primero).</li>
                        <li>Las comisiones y retenciones ya NO se configuran por regla. El sistema lee el valor real reportado por Mercado Libre para la categoría.</li>
                        <li>Si necesitas crear excepciones manuales por producto, utiliza el panel de "Auditoría de Precio" en la ficha del producto.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
