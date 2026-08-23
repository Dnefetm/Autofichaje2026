"use client";

import React, { useState, useEffect } from 'react';
import { DollarSign, ShieldCheck, AlertCircle, Clock, Save, X, Edit2, Loader2, ArrowRight, RefreshCw, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PricingAuditCardProps {
    publicacionId: string;
    salePriceCalculated: number | null;
    currentPrice?: number | null;
    draftPrice?: number | null;
    draftStatus?: string | null;
    draftDetails?: any;
    pricingStatus: string | null;
    lastCalcAt: string | null;
    onOverrideUpdated: () => void;
}

export default function PricingAuditCard({ 
    publicacionId, 
    salePriceCalculated, 
    currentPrice,
    draftPrice,
    draftStatus,
    draftDetails,
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

    const getStatusUI = (status: string | null, dStatus: string | null) => {
        if (dStatus === 'valid') return { color: 'bg-[var(--warn)]/10  text-[var(--warn)] ', text: '📝 Borrador: Cálculo Exitoso', icon: <ShieldCheck className="w-3.5 h-3.5"/> };
        if (!status || status === 'pending') return { color: 'bg-[var(--surface-2)]0 text-[var(--text)] border-[var(--border)]', text: 'Pendiente', icon: <Clock className="w-3.5 h-3.5"/> };
        if (status === 'valid') return { color: 'bg-[var(--ok)]/10  text-[var(--ok)] ', text: 'Cálculo Exitoso', icon: <ShieldCheck className="w-3.5 h-3.5"/> };
        if (status === 'override_active') return { color: 'bg-[var(--info)]/10  text-[var(--info)] border-purple-200', text: 'Excepción Manual', icon: <Edit2 className="w-3.5 h-3.5"/> };
        if (status === 'error_no_cost') return { color: 'bg-[var(--err)]/10  text-[var(--err)] ', text: 'Falta Costo Base', icon: <AlertCircle className="w-3.5 h-3.5"/> };
        if (status === 'error_negative_margin') return { color: 'bg-[var(--warn)]/10  text-[var(--warn)] ', text: 'Riesgo Margen', icon: <AlertCircle className="w-3.5 h-3.5"/> };
        return { color: 'bg-[var(--surface-2)]0 text-[var(--text)] border-[var(--border)]', text: status, icon: null };
    };

    const ui = getStatusUI(pricingStatus, draftStatus ?? null);

    return (
        <div className="bg-[var(--surface)] rounded-[var(--radius)]   overflow-hidden flex flex-col h-full">
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-2)]">
                <div className="flex items-center gap-2.5">
                    <div className="text-[var(--text-faint)]"><DollarSign className="w-4 h-4" /></div>
                    <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Auditoría de Precio</h2>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleForceRecalculate} 
                        disabled={recalculating || loading}
                        className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={cn("w-3 h-3", recalculating && "animate-spin")} />
                        Recalcular Ahora
                    </button>
                    {pricingStatus && (
                        <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] text-[10px] font-bold border', ui.color)}>
                            {ui.icon} {ui.text}
                        </span>
                    )}
                </div>
            </div>
            
            <div className="p-5 flex-1 flex flex-col">
                <div className="flex flex-col gap-4 mb-4">
                    {/* Fila 1: Precio Actual ML */}
                    <div className="bg-[var(--surface-2)] rounded-[var(--radius)] p-3 ">
                        <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">Precio Actual Mercado Libre</p>
                        <p className="text-2xl font-bold text-[var(--text)]">{fmt(currentPrice)}</p>
                        <p className="text-[10px] text-[var(--text-faint)] mt-1">
                            El precio vigente en la plataforma.
                        </p>
                    </div>

                    {/* Fila 2: Precio Draft y Fórmula Transparente */}
                    {draftPrice != null && (
                        <div className="bg-[var(--surface)] border   rounded-[var(--radius)] p-4">
                            <div className="flex items-start justify-between mb-3 border-b border-[var(--warn)]/30 pb-3">
                                <div>
                                    <p className="text-xs text-[var(--warn)] uppercase font-bold mb-1 flex items-center gap-1.5">
                                        <AlertCircle className="w-3.5 h-3.5" /> Borrador Pendiente de Aprobación
                                    </p>
                                    <p className="text-[10px] text-[var(--text-muted)] font-medium max-w-sm leading-tight mt-1">
                                        El motor sugiere un nuevo precio basado en cambios de costos o reglas. Revisa el desglose matemático antes de aplicar.
                                    </p>
                                </div>
                                <div className="text-right">
                                    <div className="flex items-center gap-3 justify-end">
                                        <p className="text-2xl font-bold text-[var(--warn)] tabular-nums">{fmt(draftPrice)}</p>
                                        {currentPrice && (
                                            <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded-[var(--radius-sm)]", 
                                                draftPrice > currentPrice ? "text-[var(--ok)] bg-[var(--ok)]/10 " : "text-[var(--err)] bg-[var(--err)]/10 ")}>
                                                {draftPrice > currentPrice ? '↑' : '↓'} {Math.abs(((draftPrice - currentPrice) / currentPrice) * 100).toFixed(1)}%
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-[var(--text-faint)] mt-1 uppercase font-semibold">Precio Sugerido</p>
                                </div>
                            </div>
                            
                            {/* Fórmula Transparente (Escalable) */}
                            {draftDetails && (
                                <div className="bg-[var(--surface-2)] rounded-[var(--radius-sm)]  p-3 mt-2">
                                    <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--text-muted)] mb-2">Desglose de la Fórmula</p>
                                    <table className="w-full text-xs">
                                        <tbody className="divide-y divide-[var(--border)]">
                                            <tr>
                                                <td className="py-1.5 text-[var(--text-muted)] font-medium">Margen Esperado</td>
                                                <td className="py-1.5 text-right font-mono text-[var(--text)] tabular-nums">
                                                    {draftDetails.margen_pct != null ? `${draftDetails.margen_pct}%` : draftDetails.margin != null ? `${draftDetails.margin}%` : '—'}
                                                </td>
                                            </tr>
                                            <tr>
                                                <td className="py-1.5 text-[var(--text-muted)] font-medium">
                                                    Comisión ML {draftDetails.comision_pct != null ? `(${draftDetails.comision_pct}%)` : ''}
                                                </td>
                                                <td className="py-1.5 text-right font-mono text-[var(--text)] tabular-nums">
                                                    {draftDetails.comision_fee != null ? fmt(draftDetails.comision_fee) : 'Incluida en Cálculo'}
                                                </td>
                                            </tr>
                                            {/* Espacio reservado para escalabilidad (Envío, Peso, Volumen, Premium vs Clásica) */}
                                            <tr>
                                                <td className="py-1.5 text-[var(--text-faint)] italic text-[10px]">Cargos de envío / logística (próximamente)</td>
                                                <td className="py-1.5 text-right font-mono text-[var(--text-faint)] tabular-nums">N/A</td>
                                            </tr>
                                        </tbody>
                                        <tfoot className="border-t border-[var(--border)] mt-1">
                                            <tr>
                                                <td className="pt-2 text-[var(--text)] font-bold">Precio Final Calculado</td>
                                                <td className="pt-2 text-right font-bold text-[var(--accent)] tabular-nums text-sm">{fmt(draftPrice)}</td>
                                            </tr>
                                            {draftDetails.reason && (
                                                <tr>
                                                    <td colSpan={2} className="pt-1 text-[9px] text-[var(--text-faint)] font-mono text-right">Nota: {draftDetails.reason}</td>
                                                </tr>
                                            )}
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Apply section */}
                <div className="mb-4 border-t border-[var(--border)] pt-4">
                    <label className="text-xs text-[var(--text-muted)] font-semibold mb-2 block">Acción / Sobreescritura</label>
                    <div className="flex gap-2 items-center">
                        <input
                            type="number"
                            placeholder={String(draftPrice || currentPrice || salePriceCalculated || '')}
                            value={editablePrice}
                            onChange={(e) => setEditablePrice(e.target.value)}
                            className=" rounded-[var(--radius-sm)] px-3 py-2 w-32 text-sm outline-none focus:border-[var(--accent)]"
                        />
                        <button
                            disabled={applying || (pricingStatus !== 'valid' && pricingStatus !== 'estimated_params' && pricingStatus !== 'override_active')}
                            onClick={() => handleApply(false)}
                            className="bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--accent-ink)] px-4 py-2 rounded-[var(--radius-sm)] flex items-center gap-1.5 text-xs font-bold transition-colors disabled:opacity-50"
                        >
                            {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            {draftPrice && !editablePrice ? 'Aprobar Borrador' : 'Aplicar Precio'}
                        </button>
                    </div>
                    {pricingStatus === 'estimated_params' && (
                        <p className="text-[var(--warn)] text-[10px] mt-2">
                            ⚠️ Comisión y retenciones son estimadas.
                        </p>
                    )}
                    {pricingStatus === 'missing_cost' && (
                        <p className="text-[var(--err)] text-[10px] mt-2">
                            ❌ Sin costo menudeo vigente.
                        </p>
                    )}
                </div>

                {/* Overrides */}
                <div className="bg-[var(--surface-2)]  rounded-[var(--radius)] p-3 mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-[var(--text)]">Regla Excepcional (Override)</p>
                        {!isEditing && (
                            <button 
                                onClick={() => setIsEditing(true)} 
                                className="text-xs text-[var(--accent)] hover:text-[var(--accent)] font-semibold"
                            >
                                {override ? 'Editar' : '+ Añadir regla'}
                            </button>
                        )}
                    </div>
                    
                    {isEditing ? (
                        <div className="space-y-2">
                            <div className="flex flex-col gap-2">
                                <select 
                                    className="w-full text-xs  rounded-[var(--radius-sm)] px-2 py-2 outline-none focus:border-[var(--accent)] bg-[var(--surface)]"
                                    value={editType}
                                    onChange={e => { setEditType(e.target.value); setEditValue(''); }}
                                >
                                    <option value="fixed_price">Precio Fijo Exacto</option>
                                    <option value="custom_margin">Margen Personalizado (%)</option>
                                    <option value="force_rule">Forzar Regla Específica</option>
                                </select>
                                
                                {editType === 'force_rule' ? (
                                    <select
                                        className="w-full text-xs  rounded-[var(--radius-sm)] px-2 py-2 outline-none focus:border-[var(--accent)] bg-[var(--surface)]"
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
                                        className="w-full text-xs  rounded-[var(--radius-sm)] px-2 py-2 outline-none focus:border-[var(--accent)]"
                                        placeholder="Valor"
                                        value={editValue}
                                        onChange={e => setEditValue(e.target.value)}
                                    />
                                )}
                            </div>
                            {errorMsg && <p className="text-[10px] text-[var(--err)]">{errorMsg}</p>}
                            <div className="flex items-center gap-2 pt-1">
                                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-3 py-1 bg-[var(--accent)] hover:bg-[var(--accent)] text-[var(--accent-ink)] text-[10px] font-bold rounded-[var(--radius-sm)] transition-colors disabled:opacity-50">
                                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Guardar
                                </button>
                                {override && (
                                    <button onClick={handleDelete} disabled={saving} className="px-3 py-1 bg-[var(--err)]/10  hover:bg-rose-200 text-[var(--err)] text-[10px] font-bold rounded-[var(--radius-sm)] transition-colors disabled:opacity-50">
                                        Eliminar regla
                                    </button>
                                )}
                                <button onClick={() => { setIsEditing(false); setErrorMsg(''); }} disabled={saving} className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-[var(--text)] text-[10px] font-bold rounded-[var(--radius-sm)] transition-colors disabled:opacity-50">
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    ) : override ? (
                        <div className="flex items-center justify-between bg-[var(--surface)]  rounded-[var(--radius-sm)] p-2">
                            <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 bg-[var(--accent)]/10 text-[var(--accent)] text-[10px] font-bold rounded-[var(--radius-sm)] uppercase">
                                    {override.override_type === 'fixed_price' ? 'Precio Fijo' 
                                     : override.override_type === 'force_rule' ? 'Regla Forzada' 
                                     : 'Margen'}
                                </span>
                                <span className="text-xs font-semibold text-[var(--text)]">
                                    {override.override_type === 'fixed_price' ? fmt(override.value) 
                                     : override.override_type === 'force_rule' ? (allRules.find(r => r.id === override.force_rule_id)?.name || 'Desconocida') 
                                     : `${override.value}%`}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <p className="text-[11px] text-[var(--text-muted)] italic">No hay excepciones manuales para esta publicación. Usa la fórmula global.</p>
                    )}
                </div>

                {/* History */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    <p className="text-xs font-bold text-[var(--text)] mb-2">Últimos Cambios en Motor V2</p>
                    {loading ? (
                        <div className="flex-1 flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-[var(--text-faint)]" /></div>
                    ) : history.length === 0 ? (
                        <p className="text-[11px] text-[var(--text-faint)] italic">No hay historial de cálculos aún.</p>
                    ) : (
                        <div className="overflow-y-auto pr-1 space-y-2 flex-1">
                            {history.map(h => (
                                <div key={h.id} className="text-[11px] bg-[var(--surface)]  rounded-[var(--radius-sm)] p-2 ">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-semibold text-[var(--text)]">{formatDate(h.created_at)}</span>
                                        <span className={cn('px-1.5 rounded-[var(--radius-sm)] text-[9px] font-bold', 
                                            h.status === 'valid' ? 'bg-[var(--ok)]/10  text-[var(--ok)]' : 
                                            h.status === 'error_no_cost' ? 'bg-[var(--err)]/10  text-[var(--err)]' :
                                            h.status === 'override_active' ? 'bg-[var(--info)]/10  text-[var(--info)]' : 'bg-[var(--surface-2)]0 text-[var(--text-muted)]'
                                        )}>
                                            {h.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-[var(--text-muted)] mb-1">
                                        <span className="line-through text-[var(--text-faint)]">{fmt(h.old_price)}</span>
                                        <ArrowRight className="w-3 h-3 text-[var(--text-faint)]" />
                                        <span className="font-bold text-[var(--accent)]">{fmt(h.new_price)}</span>
                                    </div>
                                    <p className="text-[10px] text-[var(--text-muted)] truncate" title={h.reason}>{h.reason}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Modal de confirmación para variaciones grandes */}
            {confirmingDelta && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-[var(--surface)] rounded-[var(--radius)] p-5 max-w-sm ">
                        <h3 className="font-bold text-[var(--text)] mb-2">Variación grande detectada</h3>
                        <p className="text-sm text-[var(--text-muted)] mb-4">
                            El nuevo precio cambia un <span className="font-bold">{confirmingDelta.delta.toFixed(1)}%</span> respecto al actual. ¿Confirmas este cambio?
                        </p>
                        <div className="flex justify-end gap-2">
                            <button 
                                onClick={() => setConfirmingDelta(null)}
                                className="px-4 py-2  rounded-[var(--radius-sm)] text-sm font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={() => { 
                                    setConfirmingDelta(null); 
                                    handleApply(true); 
                                }}
                                className="bg-[var(--err)] text-[var(--accent-ink)] px-4 py-2 rounded-[var(--radius-sm)] text-sm font-semibold hover:bg-rose-700"
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
