"use client";

import React, { useState, useEffect } from 'react';
import { 
    DollarSign, ShieldCheck, AlertCircle, Clock, Save, X, 
    Edit2, Loader2, ArrowRight, RefreshCw, CheckCircle2, 
    Sliders, Sparkles, HelpCircle, ChevronDown, ChevronUp, Check, Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculateFullPriceBreakdown, PricingModifiers, FullPriceBreakdown } from '@/lib/magic-rounding';

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
    
    // Edit general override (fixed price, custom margin, force rule)
    const [isEditing, setIsEditing] = useState(false);
    const [editType, setEditType] = useState<string>('fixed_price');
    const [editValue, setEditValue] = useState<string>('');
    const [saving, setSaving] = useState(false);
    const [recalculating, setRecalculating] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    
    // Modifiers panel & custom toggles
    const [showModifiersPanel, setShowModifiersPanel] = useState(false);
    const [modifiers, setModifiers] = useState<PricingModifiers>({
        aplicar_margen: true,
        margen_pct: 0,
        aplicar_comision: true,
        comision_pct: 16,
        aplicar_envio: true,
        shipping_cost_monto: 0,
        aplicar_retenciones: true,
        retenciones_pct: 9,
        aplicar_redondeo_magico: true,
        redondeo_target_pct: -10,
        redondeo_min_pct: 9,
        redondeo_max_pct: 14,
        redondeo_modo: 'magic'
    });

    // Apply functionality
    const [applying, setApplying] = useState(false);
    const [confirmingDelta, setConfirmingDelta] = useState<null | { delta: number; price: number }>(null);
    const [editablePrice, setEditablePrice] = useState<string>('');

    useEffect(() => {
        loadData();
    }, [publicacionId]);

    useEffect(() => {
        if (draftDetails) {
            const mods = draftDetails.modifiers || {};
            setModifiers({
                aplicar_margen: mods.aplicar_margen !== false,
                margen_pct: mods.margen_pct ?? draftDetails.margen_pct ?? 0,
                aplicar_comision: mods.aplicar_comision !== false,
                comision_pct: mods.comision_pct ?? draftDetails.comision_pct ?? 16,
                aplicar_envio: mods.aplicar_envio !== false,
                shipping_cost_monto: mods.shipping_cost_monto ?? draftDetails.shipping_cost ?? 0,
                envio_fijo: mods.envio_fijo ?? draftDetails.envio_fijo ?? 0,
                aplicar_retenciones: mods.aplicar_retenciones !== false,
                retenciones_pct: mods.retenciones_pct ?? draftDetails.retenciones_pct ?? 9,
                aplicar_redondeo_magico: mods.aplicar_redondeo_magico !== false,
                redondeo_target_pct: mods.redondeo_target_pct ?? -10,
                redondeo_min_pct: mods.redondeo_range?.min ?? 9,
                redondeo_max_pct: mods.redondeo_range?.max ?? 14,
                redondeo_modo: mods.redondeo_modo || 'magic'
            });
        }
    }, [draftDetails]);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/catalog/external/${publicacionId}/pricing`);
            const data = await res.json();
            setOverride(data.override);
            setHistory(data.history || []);
            setAllRules(data.allRules || []);
            
            if (data.override) {
                setEditType(data.override.override_type || 'fixed_price');
                if (data.override.override_type === 'force_rule') {
                    setEditValue(data.override.force_rule_id || '');
                } else if (data.override.value != null) {
                    setEditValue(String(data.override.value));
                }
                if (data.override.modifiers_override) {
                    setModifiers(prev => ({ ...prev, ...data.override.modifiers_override }));
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveGeneralOverride = async () => {
        setSaving(true);
        setErrorMsg('');
        try {
            let val: number | null = null;
            let force_rule_id: string | null = null;

            if (editType === 'force_rule') {
                if (!editValue) throw new Error("Debes seleccionar una regla");
                force_rule_id = editValue;
                val = 0;
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

    const handleSaveModifiersOverride = async (updatedMods: PricingModifiers) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/catalog/external/${publicacionId}/pricing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    modifiers_override: updatedMods
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            await loadData();
            onOverrideUpdated();
        } catch (err: any) {
            console.error(err);
            alert('Error guardando modificadores: ' + err.message);
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
                body: JSON.stringify({ override_type: null, value: null, modifiers_override: null })
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
        n != null ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
        
    const formatDate = (d: string) => new Date(d).toLocaleString('es-MX', { 
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
    });

    const getStatusUI = (status: string | null, dStatus: string | null) => {
        if (dStatus === 'valid') return { color: 'bg-[var(--warn)]/10 text-[var(--warn)] border-[var(--warn)]/30', text: '📝 Borrador: Cálculo Exitoso', icon: <ShieldCheck className="w-3.5 h-3.5"/> };
        if (!status || status === 'pending') return { color: 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]', text: 'Pendiente', icon: <Clock className="w-3.5 h-3.5"/> };
        if (status === 'valid') return { color: 'bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30', text: 'Cálculo Exitoso', icon: <ShieldCheck className="w-3.5 h-3.5"/> };
        if (status === 'override_active') return { color: 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30', text: 'Excepción Manual', icon: <Edit2 className="w-3.5 h-3.5"/> };
        if (status === 'error_no_cost' || status === 'missing_cost') return { color: 'bg-[var(--err)]/10 text-[var(--err)] border-[var(--err)]/30', text: 'Falta Costo Base', icon: <AlertCircle className="w-3.5 h-3.5"/> };
        if (status === 'error_negative_margin') return { color: 'bg-[var(--warn)]/10 text-[var(--warn)] border-[var(--warn)]/30', text: 'Riesgo Margen', icon: <AlertCircle className="w-3.5 h-3.5"/> };
        return { color: 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--border)]', text: status, icon: null };
    };

    const ui = getStatusUI(pricingStatus, draftStatus ?? null);

    // Calcular desglose inmediato en cliente si draftDetails tiene la información
    const detailsMods = draftDetails?.modifiers;
    const subtotalCalculado = detailsMods?.subtotal_sin_redondeo ?? draftDetails?.subtotal ?? null;
    const ajusteRedondeo = detailsMods?.redondeo_ajuste ?? (draftPrice && subtotalCalculado ? draftPrice - subtotalCalculado : null);

    return (
        <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden flex flex-col h-full shadow-sm">
            {/* Header */}
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-2)]">
                <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-[var(--accent)]"><DollarSign className="w-4 h-4" /></div>
                    <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider whitespace-nowrap">Auditoría de Precio</h2>
                </div>
                <div className="flex items-center gap-2.5">
                    <button 
                        onClick={handleForceRecalculate} 
                        disabled={recalculating || loading}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/25 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5", recalculating && "animate-spin")} />
                        Recalcular
                    </button>
                    {pricingStatus && (
                        <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] text-xs font-bold border', ui.color)}>
                            {ui.icon} {ui.text}
                        </span>
                    )}
                </div>
            </div>
            
            <div className="p-5 flex-1 flex flex-col space-y-4">
                {/* Precios Principales */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Precio Actual */}
                    <div className="bg-[var(--surface-2)]/60 border border-[var(--border)] rounded-[var(--radius)] p-3.5">
                        <p className="text-xs text-[var(--text-muted)] uppercase font-semibold mb-1">Precio Actual MeLi</p>
                        <p className="text-2xl font-bold text-[var(--text)] font-mono">{fmt(currentPrice)}</p>
                        <p className="text-xs text-[var(--text-faint)] mt-1">Precio publicado en la plataforma.</p>
                    </div>

                    {/* Precio Sugerido (Draft) */}
                    <div className="bg-[var(--surface-2)]/90 border border-[var(--warn)]/40 rounded-[var(--radius)] p-3.5">
                        <div className="flex items-center justify-between">
                            <p className="text-xs text-[var(--warn)] uppercase font-bold flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5" /> Precio Sugerido
                            </p>
                            {currentPrice && draftPrice && (
                                <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded", 
                                    draftPrice > currentPrice ? "text-[var(--ok)] bg-[var(--ok)]/15" : "text-[var(--err)] bg-[var(--err)]/15")}>
                                    {draftPrice > currentPrice ? '↑' : '↓'} {Math.abs(((draftPrice - currentPrice) / currentPrice) * 100).toFixed(1)}%
                                </span>
                            )}
                        </div>
                        <p className="text-2xl font-bold text-[var(--warn)] font-mono mt-1">{fmt(draftPrice)}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">Con Redondeo Mágico aplicado.</p>
                    </div>
                </div>

                {/* TABLA TRANSPARENTE: DESGLOSE DE FÓRMULA Y MODIFICADORES */}
                {draftDetails && (
                    <div className="bg-[var(--surface-2)]/50 border border-[var(--border)] rounded-[var(--radius)] p-4 space-y-3">
                        <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                            <div className="flex items-center gap-2">
                                <Sliders className="w-4 h-4 text-[var(--accent)]" />
                                <h3 className="text-xs uppercase font-bold text-[var(--text)] tracking-wider">Fórmula Transparente y Modificadores</h3>
                            </div>
                            <button
                                onClick={() => setShowModifiersPanel(!showModifiersPanel)}
                                className="text-xs font-semibold text-[var(--accent)] hover:underline flex items-center gap-1"
                            >
                                {showModifiersPanel ? 'Ocultar Modificadores' : 'Personalizar Variables'}
                                {showModifiersPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                        </div>

                        {/* PANEL INTERACTIVO DE MODIFICADORES POR PUBLICACIÓN */}
                        {showModifiersPanel && (
                            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3.5 space-y-3 animate-in fade-in duration-150">
                                <p className="text-xs font-bold text-[var(--text)]">Control Específico de Modificadores (Override Individual)</p>
                                
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                                    {/* 1. Margen */}
                                    <label className="flex items-center justify-between p-2 rounded bg-[var(--surface-2)] border border-[var(--border)] cursor-pointer">
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="checkbox" 
                                                checked={modifiers.aplicar_margen}
                                                onChange={(e) => setModifiers(prev => ({ ...prev, aplicar_margen: e.target.checked }))}
                                                className="rounded text-[var(--accent)]"
                                            />
                                            <span className="text-[var(--text)] font-medium">Margen / Rentabilidad</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <input 
                                                type="number"
                                                value={modifiers.margen_pct}
                                                disabled={!modifiers.aplicar_margen}
                                                onChange={(e) => setModifiers(prev => ({ ...prev, margen_pct: parseFloat(e.target.value) || 0 }))}
                                                className="w-14 text-right p-1 bg-[var(--surface)] border border-[var(--border)] rounded font-mono text-xs disabled:opacity-40"
                                            />
                                            <span className="text-[var(--text-muted)]">%</span>
                                        </div>
                                    </label>

                                    {/* 2. Comisión */}
                                    <label className="flex items-center justify-between p-2 rounded bg-[var(--surface-2)] border border-[var(--border)] cursor-pointer">
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="checkbox" 
                                                checked={modifiers.aplicar_comision}
                                                onChange={(e) => setModifiers(prev => ({ ...prev, aplicar_comision: e.target.checked }))}
                                                className="rounded text-[var(--accent)]"
                                            />
                                            <span className="text-[var(--text)] font-medium">Comisión ML</span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="font-mono text-[var(--text)]">{modifiers.comision_pct}%</span>
                                        </div>
                                    </label>

                                    {/* 3. Envío */}
                                    <label className="flex items-center justify-between p-2 rounded bg-[var(--surface-2)] border border-[var(--border)] cursor-pointer">
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="checkbox" 
                                                checked={modifiers.aplicar_envio}
                                                onChange={(e) => setModifiers(prev => ({ ...prev, aplicar_envio: e.target.checked }))}
                                                className="rounded text-[var(--accent)]"
                                            />
                                            <span className="text-[var(--text)] font-medium">Costo de Envío</span>
                                        </div>
                                        <span className="font-mono text-[var(--text)]">{fmt(modifiers.shipping_cost_monto)}</span>
                                    </label>

                                    {/* 4. Retenciones */}
                                    <label className="flex items-center justify-between p-2 rounded bg-[var(--surface-2)] border border-[var(--border)] cursor-pointer">
                                        <div className="flex items-center gap-2">
                                            <input 
                                                type="checkbox" 
                                                checked={modifiers.aplicar_retenciones}
                                                onChange={(e) => setModifiers(prev => ({ ...prev, aplicar_retenciones: e.target.checked }))}
                                                className="rounded text-[var(--accent)]"
                                            />
                                            <span className="text-[var(--text)] font-medium">Retención Fiscal (ISR/IVA)</span>
                                        </div>
                                        <span className="font-mono text-[var(--text)]">{modifiers.retenciones_pct}%</span>
                                    </label>

                                    {/* 5. Redondeo Mágico */}
                                    <label className="sm:col-span-2 flex flex-col gap-2 p-2 rounded bg-[var(--surface-2)] border border-[var(--border)]">
                                        <div className="flex items-center gap-2 cursor-pointer">
                                            <input 
                                                type="checkbox" 
                                                checked={modifiers.aplicar_redondeo_magico}
                                                onChange={(e) => setModifiers(prev => ({ ...prev, aplicar_redondeo_magico: e.target.checked }))}
                                                className="rounded text-[var(--accent)]"
                                            />
                                            <span className="text-[var(--text)] font-medium">Redondeo Mágico Estratégico (Prioridad: 1, 7, 4, 2...)</span>
                                        </div>
                                        {modifiers.aplicar_redondeo_magico && (
                                            <div className="grid grid-cols-3 gap-2 pl-6 mt-1">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[var(--text-muted)] text-[10px] uppercase font-bold">Objetivo (%)</span>
                                                    <input 
                                                        type="number"
                                                        value={modifiers.redondeo_target_pct}
                                                        onChange={(e) => setModifiers(prev => ({ ...prev, redondeo_target_pct: parseFloat(e.target.value) || 0 }))}
                                                        className="w-full text-right p-1 bg-[var(--surface)] border border-[var(--border)] rounded font-mono text-xs font-bold text-[var(--accent)]"
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[var(--text-faint)] text-[10px] uppercase font-bold">Mínimo (%)</span>
                                                    <input 
                                                        type="number"
                                                        value={modifiers.redondeo_min_pct}
                                                        onChange={(e) => setModifiers(prev => ({ ...prev, redondeo_min_pct: parseFloat(e.target.value) || 0 }))}
                                                        className="w-full text-right p-1 bg-[var(--surface)] border border-[var(--border)] rounded font-mono text-xs"
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[var(--text-faint)] text-[10px] uppercase font-bold">Máximo (%)</span>
                                                    <input 
                                                        type="number"
                                                        value={modifiers.redondeo_max_pct}
                                                        onChange={(e) => setModifiers(prev => ({ ...prev, redondeo_max_pct: parseFloat(e.target.value) || 0 }))}
                                                        className="w-full text-right p-1 bg-[var(--surface)] border border-[var(--border)] rounded font-mono text-xs"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </label>
                                </div>

                                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                                    <button
                                        onClick={() => setShowModifiersPanel(false)}
                                        className="px-3 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={() => handleSaveModifiersOverride(modifiers)}
                                        disabled={saving}
                                        className="px-4 py-1 bg-[var(--accent)] text-[var(--accent-ink)] rounded text-xs font-bold flex items-center gap-1.5 hover:brightness-110 disabled:opacity-50"
                                    >
                                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                        Guardar y Recalcular
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* DESGLOSE MATEMÁTICO TRANSPARENTE EN PASOS */}
                        <div className="space-y-3 mt-2">
                            {/* PASO 1: Costos de Recuperación (Numerador) */}
                            <div className="bg-[var(--bg)] border border-[var(--border)] rounded p-3 flex flex-col gap-2">
                                <div className="text-[10px] uppercase font-bold text-[var(--text-faint)]">1. Costos de Recuperación Directa</div>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-3">
                                    <div className="flex flex-col">
                                        <span className="text-[var(--text-muted)]">Costo {draftDetails.cost_basis || 'Base'} + Margen ({detailsMods?.margen_pct ?? draftDetails.margen_pct}%)</span>
                                        <span className="font-mono text-[var(--text)] font-semibold">{fmt(draftDetails.costo_base)} + {fmt(detailsMods?.margen_monto ?? (draftDetails.costo_base * ((draftDetails.margen_pct || 0) / 100)))}</span>
                                    </div>
                                    <div className="hidden sm:block text-[var(--text-faint)]">+</div>
                                    <div className="flex flex-col">
                                        <span className="text-[var(--text-muted)]">Costo Envío Real MeLi</span>
                                        <span className="font-mono text-[var(--text)] font-semibold">{fmt(detailsMods?.shipping_cost_final ?? draftDetails.shipping_cost ?? 0)}</span>
                                    </div>
                                    <div className="hidden sm:block text-[var(--text-faint)]">=</div>
                                    <div className="flex flex-col sm:items-end">
                                        <span className="text-[var(--text-muted)]">Monto Neto a Recuperar</span>
                                        <span className="font-mono text-[var(--text)] font-bold">
                                            {fmt(
                                                (draftDetails.costo_base + (detailsMods?.margen_monto ?? (draftDetails.costo_base * ((draftDetails.margen_pct || 0) / 100)))) + 
                                                (detailsMods?.shipping_cost_final ?? draftDetails.shipping_cost ?? 0)
                                            )}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* PASO 2: Factor de Deducciones (Denominador) */}
                            <div className="bg-[var(--bg)] border border-[var(--border)] rounded p-3 flex flex-col gap-2">
                                <div className="text-[10px] uppercase font-bold text-[var(--text-faint)]">2. Factor de Retención Marketplace</div>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-3">
                                    <div className="flex flex-col">
                                        <span className="text-[var(--text-muted)]">Comisión ML + Retención Fiscal</span>
                                        <span className="font-mono text-[var(--text)] font-semibold">
                                            {detailsMods?.comision_pct ?? draftDetails.comision_pct}% + {detailsMods?.retenciones_pct ?? draftDetails.retenciones_pct}% = {(detailsMods?.comision_pct ?? draftDetails.comision_pct) + (detailsMods?.retenciones_pct ?? draftDetails.retenciones_pct)}%
                                        </span>
                                    </div>
                                    <div className="hidden sm:block text-[var(--text-faint)]">→</div>
                                    <div className="flex flex-col sm:items-end">
                                        <span className="text-[var(--text-muted)]">Multiplicador (1 - Deducciones)</span>
                                        <span className="font-mono text-[var(--text)] font-bold">
                                            {(1 - (((detailsMods?.comision_pct ?? draftDetails.comision_pct) + (detailsMods?.retenciones_pct ?? draftDetails.retenciones_pct)) / 100)).toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* PASO 3: Equilibrio y Redondeo */}
                            <div className="bg-[var(--surface)] border-2 border-[var(--border)] rounded p-3 flex flex-col gap-2 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-[var(--accent)]/5 rounded-bl-full -z-0"></div>
                                <div className="text-[10px] uppercase font-bold text-[var(--text-faint)] relative z-10 flex justify-between">
                                    <span>3. Precio de Equilibrio y Optimización Mágica</span>
                                    {draftDetails.rule_name && (
                                        <span className="text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded font-mono">
                                            Perfil: {draftDetails.rule_name}
                                        </span>
                                    )}
                                </div>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-4 relative z-10 mt-1">
                                    <div className="flex flex-col bg-[var(--surface-2)] p-2 rounded border border-[var(--border)]">
                                        <span className="text-[var(--text-muted)]">Subtotal Exacto</span>
                                        <span className="font-mono text-[var(--text)] font-bold text-sm">{fmt(subtotalCalculado)}</span>
                                    </div>
                                    <div className="flex flex-col items-center text-[var(--accent)] px-2">
                                        <span className="text-[10px] uppercase font-bold flex items-center gap-1">
                                            <Sparkles className="w-3 h-3"/> Ajuste Redondeo ({detailsMods?.redondeo_target_pct ?? -10}%)
                                        </span>
                                        <span className="font-mono font-bold text-sm">
                                            {ajusteRedondeo != null ? (ajusteRedondeo >= 0 ? `+${fmt(ajusteRedondeo)}` : `-${fmt(Math.abs(ajusteRedondeo))}`) : '—'}
                                        </span>
                                    </div>
                                    <div className="flex flex-col sm:items-end bg-[var(--warn)]/10 p-2 rounded border border-[var(--warn)]/30">
                                        <span className="text-[var(--warn)] font-bold uppercase text-[10px]">Precio Sugerido</span>
                                        <span className="font-mono text-[var(--warn)] font-bold text-xl leading-none">{fmt(draftPrice)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Sección de Aprobación y Aplicación */}
                <div className="border-t border-[var(--border)] pt-4 space-y-3">
                    <label className="text-xs text-[var(--text-muted)] font-semibold block">Acción de Precio</label>
                    <div className="flex flex-wrap gap-2 items-center">
                        <input
                            type="number"
                            placeholder={String(draftPrice || currentPrice || salePriceCalculated || '')}
                            value={editablePrice}
                            onChange={(e) => setEditablePrice(e.target.value)}
                            className="bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-[var(--radius-sm)] px-3 py-2 w-36 text-sm outline-none focus:border-[var(--accent)] font-mono"
                        />
                        <button
                            disabled={applying || (draftPrice ? (draftStatus !== 'valid' && draftStatus !== 'estimated_params' && draftStatus !== 'override_active') : (pricingStatus !== 'valid' && pricingStatus !== 'estimated_params' && pricingStatus !== 'override_active'))}
                            onClick={() => handleApply(false)}
                            className="bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] px-4 py-2 rounded-[var(--radius-sm)] flex items-center gap-1.5 text-xs font-bold transition-all disabled:opacity-50 shadow-sm"
                        >
                            {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            {draftPrice && !editablePrice ? 'Aprobar Borrador' : 'Aplicar Precio Manual'}
                        </button>
                    </div>

                    {/* Excepciones Manuales (Override Fijo / Regla Forzada) */}
                    <div className="flex items-center justify-between text-xs pt-1">
                        <button
                            onClick={() => setIsEditing(!isEditing)}
                            className="text-[var(--accent)] hover:underline flex items-center gap-1 font-medium"
                        >
                            <Edit2 className="w-3 h-3" />
                            {override ? 'Modificar Excepción de Regla' : 'Configurar Precio Fijo Forzado'}
                        </button>
                        {override && (
                            <button
                                onClick={handleDelete}
                                className="text-[var(--err)] hover:underline"
                            >
                                Eliminar Excepción
                            </button>
                        )}
                    </div>

                    {isEditing && (
                        <div className="p-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg space-y-3 animate-in fade-in">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <button
                                    onClick={() => setEditType('fixed_price')}
                                    className={cn("p-2 rounded border font-medium text-center", editType === 'fixed_price' ? "bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]" : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]")}
                                >
                                    Precio Fijo
                                </button>
                                <button
                                    onClick={() => setEditType('force_rule')}
                                    className={cn("p-2 rounded border font-medium text-center", editType === 'force_rule' ? "bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]" : "bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]")}
                                >
                                    Forzar Otra Regla
                                </button>
                            </div>

                            {editType === 'fixed_price' ? (
                                <input
                                    type="number"
                                    placeholder="Precio fijo manual..."
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    className="w-full p-2 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] rounded text-xs outline-none"
                                />
                            ) : (
                                <select
                                    value={editValue}
                                    onChange={(e) => setEditValue(e.target.value)}
                                    className="w-full p-2 bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] rounded text-xs outline-none"
                                >
                                    <option value="">Selecciona una regla...</option>
                                    {allRules.map(r => (
                                        <option key={r.id} value={r.id}>{r.name} (Prioridad {r.priority})</option>
                                    ))}
                                </select>
                            )}

                            {errorMsg && <p className="text-xs text-[var(--err)]">{errorMsg}</p>}

                            <div className="flex justify-end gap-2">
                                <button onClick={() => setIsEditing(false)} className="px-3 py-1 text-xs text-[var(--text-muted)]">Cancelar</button>
                                <button onClick={handleSaveGeneralOverride} disabled={saving} className="px-4 py-1 bg-[var(--accent)] text-[var(--accent-ink)] rounded text-xs font-bold">
                                    {saving ? 'Guardando...' : 'Guardar'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
