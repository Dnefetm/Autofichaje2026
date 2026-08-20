"use client";

import React, { useState, useEffect } from 'react';
import { DollarSign, ShieldCheck, AlertCircle, Clock, Save, X, Edit2, Loader2, ArrowRight, RefreshCw, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PricingAuditCardProps {
    publicacionId: string;
    salePriceCalculated: number | null;
    currentPrice?: number | null;
    draftPrice?: number | null;
    pricingStatus: string | null;
    lastCalcAt: string | null;
    onOverrideUpdated: () => void;
}

export default function PricingAuditCard({ 
    publicacionId, 
    salePriceCalculated, 
    currentPrice,
    draftPrice,
    pricingStatus, 
    lastCalcAt,
    onOverrideUpdated 
}: PricingAuditCardProps) {
    const [loading, setLoading] = useState(true);
    const [override, setOverride] = useState<any>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [allRules, setAllRules] = useState<any[]>([]);
    
    const [isEditing, setIsEditing] = useState(false);
    const [editType, setEditType] = useState<string>('fixed_price');
    const [editValue, setEditValue] = useState<string>('');
    const [saving, setSaving] = useState(false);
    const [recalculating, setRecalculating] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    
    // New states for apply functionality
    const [applying, setApplying] = useState(false);
    const [confirmingDelta, setConfirmingDelta] = useState<null | { delta: number; price: number }>(null);
    const [editablePrice, setEditablePrice] = useState<string>('');

    useEffect(() => {
        loadData();
    }, [publicacionId]);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/catalog/external/${publicacionId}/pricing`);
            const data = await res.json();
            setOverride(data.override);
            setHistory(data.history || []);
            setAllRules(data.allRules || []);
            
            if (data.override) {
                setEditType(data.override.override_type);
                if (data.override.override_type === 'force_rule') {
                    setEditValue(data.override.force_rule_id || '');
                } else {
                    setEditValue(String(data.override.value || ''));
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setErrorMsg('');
        try {
            let val: number | null = null;
            let force_rule_id: string | null = null;

            if (editType === 'force_rule') {
                if (!editValue) throw new Error("Debes seleccionar una regla");
                force_rule_id = editValue;
                val = 0; // Value is ignored but required for not deleting
            } else {
                val = parseFloat(editValue);
                if (isNaN(val) || val <= 0) throw new Error("Valor numérico inválido");
            }
            
            const res = await fetch(`/api/catalog/external/${publicacionId}/pricing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    override_type: editType,
                    value: val,
                    force_rule_id
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            setIsEditing(false);
            await loadData();
            onOverrideUpdated();
        } catch (err: any) {
            setErrorMsg(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        setSaving(true);
        try {
            await fetch(`/api/catalog/external/${publicacionId}/pricing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ override_type: null, value: null })
            });
            setIsEditing(false);
            setEditValue('');
            setEditType('fixed_price');
            await loadData();
            onOverrideUpdated();
        } catch (err) {
            console.error(err);
        } finally {
            setSaving(false);
        }
    };

    const handleForceRecalculate = async () => {
        setRecalculating(true);
        try {
            const res = await fetch(`/api/catalog/external/${publicacionId}/pricing`, { method: 'PUT' });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error);
            }
            await loadData();
            onOverrideUpdated();
        } catch (err: any) {
            console.error(err);
            alert('Error: ' + (err.message || 'Desconocido'));
        } finally {
            setRecalculating(false);
        }
    };

    const handleApply = async (force = false) => {
        setApplying(true);
        try {
            const finalPrice = editablePrice ? parseFloat(editablePrice) : (draftPrice || salePriceCalculated || 0);
            const res = await fetch(`/api/catalog/external/${publicacionId}/pricing/apply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmed_price: finalPrice, reason: 'aprobado_manualmente', force })
            });
            const data = await res.json();
            if (data.requires_confirmation) {
                setConfirmingDelta({ delta: data.delta_percent, price: finalPrice });
            } else if (data.success) {
                
                // Si aprobamos un draft exitosamente usando el apply nativo, llamamos al nuevo batch approve por si acaso
                if (draftPrice && !editablePrice) {
                    await fetch(`/api/pricing/approve-drafts`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ publicaciones: [publicacionId] })
                    });
                }

                setEditablePrice('');
                onOverrideUpdated();
            } else if (data.error) {
                alert('Error: ' + data.error);
            }
        } catch (err: any) {
            console.error(err);
            alert('Error: ' + (err.message || 'Desconocido'));
        } finally {
            setApplying(false);
        }
    };

    const fmt = (n: number | null | undefined) => 
        n != null ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '—';
        
    const formatDate = (d: string) => new Date(d).toLocaleString('es-MX', { 
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
    });

    const getStatusUI = (status: string | null) => {
        if (!status || status === 'pending') return { color: 'bg-slate-100 text-slate-700 border-slate-200', text: 'Pendiente', icon: <Clock className="w-3.5 h-3.5"/> };
        if (status === 'valid') return { color: 'bg-green-100 text-green-700 border-green-200', text: 'Cálculo Exitoso', icon: <ShieldCheck className="w-3.5 h-3.5"/> };
        if (status === 'override_active') return { color: 'bg-purple-100 text-purple-700 border-purple-200', text: 'Excepción Manual', icon: <Edit2 className="w-3.5 h-3.5"/> };
        if (status === 'error_no_cost') return { color: 'bg-rose-100 text-rose-700 border-rose-200', text: 'Falta Costo Base', icon: <AlertCircle className="w-3.5 h-3.5"/> };
        if (status === 'error_negative_margin') return { color: 'bg-amber-100 text-amber-700 border-amber-200', text: 'Riesgo Margen', icon: <AlertCircle className="w-3.5 h-3.5"/> };
        return { color: 'bg-slate-100 text-slate-700', text: status, icon: null };
    };

    const ui = getStatusUI(pricingStatus);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2.5">
                    <div className="text-slate-400"><DollarSign className="w-4 h-4" /></div>
                    <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Auditoría de Precio</h2>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleForceRecalculate} 
                        disabled={recalculating || loading}
                        className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={cn("w-3 h-3", recalculating && "animate-spin")} />
                        Recalcular Ahora
                    </button>
                    {pricingStatus && (
                        <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold border', ui.color)}>
                            {ui.icon} {ui.text}
                        </span>
                    )}
                </div>
            </div>
            
            <div className="p-5 flex-1 flex flex-col">
                <div className="flex flex-col gap-4 mb-4">
                    {/* Fila 1: Precio Actual ML */}
                    <div className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                        <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Precio Actual Mercado Libre</p>
                        <p className="text-2xl font-bold text-slate-700">{fmt(currentPrice)}</p>
                        <p className="text-[10px] text-slate-400 mt-1">
                            El precio vigente en la plataforma.
                        </p>
                    </div>

                    {/* Fila 2: Precio Draft (Si existe) */}
                    {draftPrice && draftPrice !== currentPrice && (
                        <div className="bg-amber-50 rounded-lg p-3 border border-amber-200 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-16 h-16 bg-amber-100 rounded-bl-full -z-10" />
                            <p className="text-xs text-amber-700 uppercase font-bold mb-1 flex items-center gap-1.5">
                                <AlertCircle className="w-3.5 h-3.5" /> Precio Sugerido (Draft)
                            </p>
                            <div className="flex items-end gap-3">
                                <p className="text-2xl font-bold text-amber-900">{fmt(draftPrice)}</p>
                                {currentPrice && (
                                    <span className={cn("text-xs font-bold mb-1 px-1.5 py-0.5 rounded", 
                                        draftPrice > currentPrice ? "text-green-700 bg-green-100" : "text-red-700 bg-red-100")}>
                                        {draftPrice > currentPrice ? '↑' : '↓'} {Math.abs(((draftPrice - currentPrice) / currentPrice) * 100).toFixed(1)}%
                                    </span>
                                )}
                            </div>
                            <p className="text-[10px] text-amber-600 mt-1.5 font-medium">
                                Cambios en componentes o bundles generaron esta sugerencia. Pendiente de aprobación.
                            </p>
                        </div>
                    )}
                </div>

                {/* Apply section */}
                <div className="mb-4 border-t border-slate-100 pt-4">
                    <label className="text-xs text-slate-500 font-semibold mb-2 block">Acción / Sobreescritura</label>
                    <div className="flex gap-2 items-center">
                        <input
                            type="number"
                            placeholder={String(draftPrice || currentPrice || salePriceCalculated || '')}
                            value={editablePrice}
                            onChange={(e) => setEditablePrice(e.target.value)}
                            className="border border-slate-200 rounded px-3 py-2 w-32 text-sm outline-none focus:border-indigo-400"
                        />
                        <button
                            disabled={applying || (pricingStatus !== 'valid' && pricingStatus !== 'estimated_params' && pricingStatus !== 'override_active')}
                            onClick={() => handleApply(false)}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded flex items-center gap-1.5 text-xs font-bold transition-colors disabled:opacity-50"
                        >
                            {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            {draftPrice && !editablePrice ? 'Aprobar Borrador' : 'Aplicar Precio'}
                        </button>
                    </div>
                    {pricingStatus === 'estimated_params' && (
                        <p className="text-amber-600 text-[10px] mt-2">
                            ⚠️ Comisión y retenciones son estimadas.
                        </p>
                    )}
                    {pricingStatus === 'missing_cost' && (
                        <p className="text-rose-600 text-[10px] mt-2">
                            ❌ Sin costo menudeo vigente.
                        </p>
                    )}
                </div>

                {/* Overrides */}
                <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-slate-700">Regla Excepcional (Override)</p>
                        {!isEditing && (
                            <button 
                                onClick={() => setIsEditing(true)} 
                                className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                            >
                                {override ? 'Editar' : '+ Añadir regla'}
                            </button>
                        )}
                    </div>
                    
                    {isEditing ? (
                        <div className="space-y-2">
                            <div className="flex flex-col gap-2">
                                <select 
                                    className="w-full text-xs border border-slate-200 rounded px-2 py-2 outline-none focus:border-indigo-400 bg-white"
                                    value={editType}
                                    onChange={e => { setEditType(e.target.value); setEditValue(''); }}
                                >
                                    <option value="fixed_price">Precio Fijo Exacto</option>
                                    <option value="custom_margin">Margen Personalizado (%)</option>
                                    <option value="force_rule">Forzar Regla Específica</option>
                                </select>
                                
                                {editType === 'force_rule' ? (
                                    <select
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-2 outline-none focus:border-indigo-400 bg-white"
                                        value={editValue}
                                        onChange={e => setEditValue(e.target.value)}
                                    >
                                        <option value="">Selecciona regla...</option>
                                        {allRules.map(r => (
                                            <option key={r.id} value={r.id}>#{r.priority} {r.name}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input 
                                        type="number" 
                                        className="w-full text-xs border border-slate-200 rounded px-2 py-2 outline-none focus:border-indigo-400"
                                        placeholder="Valor"
                                        value={editValue}
                                        onChange={e => setEditValue(e.target.value)}
                                    />
                                )}
                            </div>
                            {errorMsg && <p className="text-[10px] text-rose-500">{errorMsg}</p>}
                            <div className="flex items-center gap-2 pt-1">
                                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold rounded transition-colors disabled:opacity-50">
                                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Guardar
                                </button>
                                {override && (
                                    <button onClick={handleDelete} disabled={saving} className="px-3 py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 text-[10px] font-bold rounded transition-colors disabled:opacity-50">
                                        Eliminar regla
                                    </button>
                                )}
                                <button onClick={() => { setIsEditing(false); setErrorMsg(''); }} disabled={saving} className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-bold rounded transition-colors disabled:opacity-50">
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    ) : override ? (
                        <div className="flex items-center justify-between bg-white border border-slate-200 rounded p-2">
                            <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded uppercase">
                                    {override.override_type === 'fixed_price' ? 'Precio Fijo' 
                                     : override.override_type === 'force_rule' ? 'Regla Forzada' 
                                     : 'Margen'}
                                </span>
                                <span className="text-xs font-semibold text-slate-700">
                                    {override.override_type === 'fixed_price' ? fmt(override.value) 
                                     : override.override_type === 'force_rule' ? (allRules.find(r => r.id === override.force_rule_id)?.name || 'Desconocida') 
                                     : `${override.value}%`}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <p className="text-[11px] text-slate-500 italic">No hay excepciones manuales para esta publicación. Usa la fórmula global.</p>
                    )}
                </div>

                {/* History */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    <p className="text-xs font-bold text-slate-700 mb-2">Últimos Cambios en Motor V2</p>
                    {loading ? (
                        <div className="flex-1 flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-300" /></div>
                    ) : history.length === 0 ? (
                        <p className="text-[11px] text-slate-400 italic">No hay historial de cálculos aún.</p>
                    ) : (
                        <div className="overflow-y-auto pr-1 space-y-2 flex-1">
                            {history.map(h => (
                                <div key={h.id} className="text-[11px] bg-white border border-slate-100 rounded p-2 shadow-sm">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-semibold text-slate-700">{formatDate(h.created_at)}</span>
                                        <span className={cn('px-1.5 rounded text-[9px] font-bold', 
                                            h.status === 'valid' ? 'bg-green-100 text-green-700' : 
                                            h.status === 'error_no_cost' ? 'bg-rose-100 text-rose-700' :
                                            h.status === 'override_active' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                                        )}>
                                            {h.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-slate-600 mb-1">
                                        <span className="line-through text-slate-400">{fmt(h.old_price)}</span>
                                        <ArrowRight className="w-3 h-3 text-slate-300" />
                                        <span className="font-bold text-indigo-700">{fmt(h.new_price)}</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 truncate" title={h.reason}>{h.reason}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Modal de confirmación para variaciones grandes */}
            {confirmingDelta && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-5 max-w-sm shadow-xl">
                        <h3 className="font-bold text-slate-900 mb-2">Variación grande detectada</h3>
                        <p className="text-sm text-slate-600 mb-4">
                            El nuevo precio cambia un <span className="font-bold">{confirmingDelta.delta.toFixed(1)}%</span> respecto al actual. ¿Confirmas este cambio?
                        </p>
                        <div className="flex justify-end gap-2">
                            <button 
                                onClick={() => setConfirmingDelta(null)}
                                className="px-4 py-2 border border-slate-200 rounded text-sm font-semibold text-slate-600 hover:bg-slate-50"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={() => { 
                                    setConfirmingDelta(null); 
                                    handleApply(true); 
                                }}
                                className="bg-rose-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-rose-700"
                            >
                                Sí, aplicar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
