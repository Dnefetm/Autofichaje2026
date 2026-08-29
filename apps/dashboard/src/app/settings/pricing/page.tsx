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

    if (loading) return <div className="p-10 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" /></div>;

    const RuleForm = ({ initialData, onCancel }: { initialData?: any, onCancel: () => void }) => {
        const [formData, setFormData] = useState(initialData || {
            name: '', priority: 100, is_active: true, cost_basis: 'menudeo', 
            margen_objetivo: 20, redondeo: 'magic', envio_fijo: 0,
            marca: '', category_id: '', articulo_id: '',
            aplicar_margen: true, aplicar_comision: true, aplicar_envio: true, aplicar_retenciones: true,
            aplicar_redondeo_magico: true, redondeo_target_pct: -10, redondeo_min_pct: 9, redondeo_max_pct: 14
        });

        return (
            <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-5 mt-4 space-y-4 shadow-sm animate-in fade-in zoom-in-95">
                <div className="flex items-center justify-between">
                    <h4 className="font-bold text-[var(--text)]">{initialData ? 'Editar Regla' : 'Nueva Regla V3'}</h4>
                    <button onClick={onCancel} className="text-[var(--text-faint)] hover:text-[var(--text-muted)]"><X className="w-4 h-4"/></button>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="col-span-2">
                        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Nombre Descriptivo</label>
                        <input className="w-full border rounded px-3 py-1.5 text-sm" value={formData.name} onChange={e=>setFormData({...formData, name: e.target.value})} placeholder="Ej: Regla Global Base" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Prioridad (1=Alta)</label>
                        <input type="number" className="w-full border rounded px-3 py-1.5 text-sm" value={formData.priority} onChange={e=>setFormData({...formData, priority: parseInt(e.target.value)})} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Margen Objetivo (%)</label>
                        <input type="number" step="0.1" className="w-full border rounded px-3 py-1.5 text-sm" value={formData.margen_objetivo} onChange={e=>setFormData({...formData, margen_objetivo: parseFloat(e.target.value)})} />
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Filtro Marca (Opcional)</label>
                        <input className="w-full border rounded px-3 py-1.5 text-sm" value={formData.marca || ''} onChange={e=>setFormData({...formData, marca: e.target.value || null})} placeholder="Todas" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Filtro Categoría (Opcional)</label>
                        <input className="w-full border rounded px-3 py-1.5 text-sm" value={formData.category_id || ''} onChange={e=>setFormData({...formData, category_id: e.target.value || null})} placeholder="Todas" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Costo Base</label>
                        <select className="w-full border rounded px-3 py-1.5 text-sm" value={formData.cost_basis} onChange={e=>setFormData({...formData, cost_basis: e.target.value})}>
                            <option value="menudeo">Menudeo</option>
                            <option value="mayoreo">Mayoreo</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Estrategia Redondeo</label>
                        <select className="w-full border rounded px-3 py-1.5 text-sm" value={formData.redondeo} onChange={e=>setFormData({...formData, redondeo: e.target.value})}>
                            <option value="none">Sin redondeo exacto</option>
                            <option value="magic">Mágico Estratégico</option>
                            <option value="99">A .99</option>
                            <option value="00">A .00</option>
                        </select>
                    </div>
                </div>
                <div className="bg-[var(--surface-2)] p-3 rounded border border-[var(--border)] mt-2">
                    <h5 className="text-xs font-bold text-[var(--text-muted)] mb-2 uppercase tracking-wider">Modificadores de Fórmula</h5>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                            <input type="checkbox" className="rounded text-[var(--accent)]" checked={formData.aplicar_margen} onChange={e=>setFormData({...formData, aplicar_margen: e.target.checked})} />
                            Aplicar Margen
                        </label>
                        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                            <input type="checkbox" className="rounded text-[var(--accent)]" checked={formData.aplicar_comision} onChange={e=>setFormData({...formData, aplicar_comision: e.target.checked})} />
                            Comisión MeLi
                        </label>
                        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                            <input type="checkbox" className="rounded text-[var(--accent)]" checked={formData.aplicar_retenciones} onChange={e=>setFormData({...formData, aplicar_retenciones: e.target.checked})} />
                            Retenciones (ISR/IVA)
                        </label>
                        <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                            <input type="checkbox" className="rounded text-[var(--accent)]" checked={formData.aplicar_envio} onChange={e=>setFormData({...formData, aplicar_envio: e.target.checked})} />
                            Costo Envío
                        </label>
                    </div>
                </div>

                {formData.redondeo === 'magic' && (
                    <div className="grid grid-cols-3 gap-4 bg-[var(--surface-2)] p-3 rounded border border-[var(--border)]">
                        <div>
                            <label className="block text-xs font-bold text-[var(--accent)] mb-1">Objetivo Reducción (%)</label>
                            <input type="number" step="0.1" className="w-full border rounded px-3 py-1.5 text-sm" value={formData.redondeo_target_pct} onChange={e=>setFormData({...formData, redondeo_target_pct: parseFloat(e.target.value)})} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[var(--accent)] mb-1">Tolerancia Mínima (%)</label>
                            <input type="number" step="0.1" className="w-full border rounded px-3 py-1.5 text-sm" value={formData.redondeo_min_pct} onChange={e=>setFormData({...formData, redondeo_min_pct: parseFloat(e.target.value)})} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[var(--accent)] mb-1">Tolerancia Máxima (%)</label>
                            <input type="number" step="0.1" className="w-full border rounded px-3 py-1.5 text-sm" value={formData.redondeo_max_pct} onChange={e=>setFormData({...formData, redondeo_max_pct: parseFloat(e.target.value)})} />
                        </div>
                    </div>
                )}
                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                    <button onClick={onCancel} className="px-4 py-1.5 rounded text-sm font-semibold text-[var(--text-muted)] hover:bg-slate-200">Cancelar</button>
                    <button onClick={() => saveRule(formData)} disabled={saving || !formData.name} className="px-4 py-1.5 rounded text-sm font-semibold text-[var(--accent-ink)] bg-[var(--accent)] hover:brightness-110 disabled:opacity-50 flex items-center gap-1">
                        {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>} Guardar Regla
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8 p-6 animate-in fade-in slide-in-from-bottom-4">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--text)]">Motor de Precios V3 - Panel de Reglas</h2>
                <p className="text-[var(--text-muted)] text-sm mt-1">
                    Las reglas operan en cascada. El sistema evaluará cada publicación contra estas reglas en orden de prioridad (1 = Máxima prioridad) y aplicará la primera que coincida exactamente con todos sus filtros.
                </p>
            </div>

            <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--bg)] flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-[var(--text)] flex items-center gap-2">Reglas en Cascada</h3>
                        <p className="text-xs text-[var(--text-muted)] mt-1">Listado de reglas de cálculo activas.</p>
                        <div className="text-[10px] text-[var(--accent)] font-mono mt-3 mb-1 bg-[var(--accent)]/10 p-2 rounded border border-[var(--accent)]/20">
                            <b>Fórmula Matemática Transparente:</b><br/>
                            1. Subtotal = CostoBase * (1 + Margen %)<br/>
                            2. Precio Final = Subtotal / (1 - ComisiónML % - ISR/IVA %)<br/>
                            <span className="text-[var(--text-muted)] italic mt-1 block">Nota: Las reglas calculan top-down para proteger la ganancia. Si un costo ya incluye tu ganancia (ej. menudeo), deja el Margen en 0%.</span>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsCreatingRule(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] text-sm font-bold rounded shadow-sm transition-colors"
                    >
                        <Plus className="w-4 h-4" /> Nueva Regla
                    </button>
                </div>
                
                <div className="p-6">
                    {isCreatingRule && <RuleForm onCancel={() => setIsCreatingRule(false)} />}

                    <div className="mt-4 flex flex-col gap-3">
                        {rules.map((rule) => (
                            <div key={rule.id} className="border border-[var(--border)] rounded-lg p-4 hover:border-[var(--accent)]/50 transition-colors bg-[var(--surface)] shadow-sm flex flex-col md:flex-row md:items-center gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="px-2 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-muted)] font-mono text-[10px] font-bold border border-[var(--border)]">
                                            #{rule.priority}
                                        </span>
                                        <h4 className="font-bold text-[var(--text)]">{rule.name}</h4>
                                        {!rule.is_active && <span className="px-2 py-0.5 bg-rose-100 text-[var(--err)] text-[10px] font-bold rounded">INACTIVA</span>}
                                    </div>
                                    <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)] mt-2">
                                        {rule.marca && <span className="bg-[var(--accent)]/10 text-indigo-700 px-1.5 rounded">Marca: {rule.marca}</span>}
                                        {rule.category_id && <span className="bg-[var(--accent)]/10 text-indigo-700 px-1.5 rounded">Categoría: {rule.category_id}</span>}
                                        {!rule.marca && !rule.category_id && <span className="text-[var(--text-faint)] italic">Global (Aplica a todo)</span>}
                                    </div>
                                </div>
                                <div className="flex items-center gap-6 md:border-l md:border-[var(--border)] md:pl-6">
                                    <div className="text-center">
                                        <p className="text-[10px] uppercase text-[var(--text-faint)] font-bold mb-0.5">Margen</p>
                                        <p className="font-bold text-[var(--text)] text-lg">{rule.margen_objetivo}%</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-[10px] uppercase text-[var(--text-faint)] font-bold mb-0.5">Costo</p>
                                        <p className="font-semibold text-[var(--text-muted)] text-sm capitalize">{rule.cost_basis}</p>
                                    </div>
                                    <div className="flex gap-1 ml-2">
                                        <button onClick={() => setIsEditingRule(rule.id)} className="p-1.5 text-[var(--text-faint)] hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 rounded transition-colors">
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button onClick={() => deleteRule(rule.id)} className="p-1.5 text-[var(--text-faint)] hover:text-[var(--err)] hover:bg-[var(--err)]/10 rounded transition-colors">
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
                            <div className="text-center py-8 text-[var(--text-faint)] italic text-sm border-2 border-dashed border-[var(--border)] rounded-lg">
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
