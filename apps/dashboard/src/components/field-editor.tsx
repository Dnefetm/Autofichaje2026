"use client";

import { useState, useEffect, useRef } from 'react';
import { Save, RefreshCw, CheckCircle2, AlertCircle, Lock } from 'lucide-react';
import { VITRINA_FIELDS, FieldContext } from '@/lib/vitrina-fields';
import { cn } from '@/lib/utils';

interface Props {
    pubId: string;
    context: FieldContext;
    onSynced?: () => void;
}

/**
 * FieldEditor — Editor genérico y reutilizable de campos de una vidriera MeLi.
 * Renderiza los campos del esquema declarativo y sincroniza SOLO los campos
 * modificados vía PATCH /api/vitrinas/[id].
 */
export function FieldEditor({ pubId, context, onSynced }: Props) {
    const [values, setValues] = useState<Record<string, any>>({});
    const initialRef = useRef<Record<string, any>>({});
    const [saving, setSaving] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; applied?: Array<{ field: string; ok: boolean; error?: string }>; error?: string } | null>(null);

    useEffect(() => {
        const v: Record<string, any> = {};
        for (const f of VITRINA_FIELDS) v[f.id] = f.getValue(context);
        setValues(v);
        initialRef.current = { ...v };
        setResult(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [context]);

    function setVal(id: string, value: any) {
        setValues((prev) => ({ ...prev, [id]: value }));
        setResult(null);
    }

    // Campos modificados (compara contra el valor cargado al abrir)
    const changedFields = VITRINA_FIELDS.filter((f) => {
        const a = values[f.id];
        const b = initialRef.current[f.id];
        if (f.type === 'number') return Number(a) !== Number(b);
        if (f.type === 'boolean') return !!a !== !!b;
        return String(a ?? '') !== String(b ?? '');
    });

    async function save() {
        if (changedFields.length === 0) {
            setResult({ ok: false, error: 'No has cambiado ningún campo' });
            return;
        }
        setSaving(true);
        setResult(null);
        try {
            const changes = changedFields.map((f) => ({ field: f.id, value: values[f.id] }));
            const res = await fetch(`/api/vitrinas/${pubId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ changes }),
            });
            const data = await res.json();
            if (!res.ok) {
                setResult({ ok: false, error: data.error || 'Error al sincronizar' });
                return;
            }
            setResult(data);
            const anyOk = Array.isArray(data.applied) && data.applied.some((a: any) => a.ok);
            if (anyOk) {
                initialRef.current = { ...values };
                onSynced?.();
            }
        } catch (e: any) {
            setResult({ ok: false, error: e?.message || 'Error de red' });
        } finally {
            setSaving(false);
        }
    }

    const failed = Array.isArray(result?.applied) ? result.applied.filter((a) => !a.ok) : [];
    const succeeded = Array.isArray(result?.applied) ? result.applied.filter((a) => a.ok) : [];

    return (
        <div className="space-y-4">
            {VITRINA_FIELDS.map((f) => {
                const can = f.canEdit(context);
                if (!can.ok) {
                    return (
                        <div key={f.id} className="p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] opacity-70">
                            <div className="flex items-center gap-2 text-xs text-[var(--text-faint)]">
                                <Lock className="w-3.5 h-3.5 shrink-0" />
                                <span className="font-semibold text-[var(--text-muted)]">{f.label}</span>
                                <span>— {can.reason}</span>
                            </div>
                        </div>
                    );
                }

                const current = values[f.id];
                const changed = changedFields.some((c) => c.id === f.id);

                return (
                    <div key={f.id}>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-[10px] font-bold uppercase text-[var(--text-faint)] tracking-wider">{f.label}</label>
                            {f.maxLength != null && f.type === 'text' && (
                                <span className={cn(
                                    'text-[10px] font-mono',
                                    String(current ?? '').length > f.maxLength ? 'text-[var(--err)] font-bold' : 'text-[var(--text-faint)]',
                                )}>
                                    {String(current ?? '').length}/{f.maxLength}
                                </span>
                            )}
                            {changed && <span className="text-[10px] font-bold text-[var(--accent)]">● modificado</span>}
                        </div>

                        {f.type === 'text' && (
                            <textarea
                                value={current ?? ''}
                                onChange={(e) => setVal(f.id, e.target.value)}
                                rows={f.id === 'description' ? 6 : 2}
                                maxLength={f.maxLength}
                                className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
                            />
                        )}
                        {f.type === 'number' && (
                            <input
                                type="number"
                                step={f.id === 'price' ? '0.01' : '1'}
                                min={0}
                                value={current ?? ''}
                                onChange={(e) => setVal(f.id, e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] font-mono"
                            />
                        )}
                        {f.type === 'select' && (
                            <select
                                value={current ?? ''}
                                onChange={(e) => setVal(f.id, e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--surface)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                            >
                                {f.options?.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        )}
                        {f.type === 'boolean' && (
                            <button
                                type="button"
                                onClick={() => setVal(f.id, !current)}
                                className={cn(
                                    "px-3 py-2 text-sm font-bold rounded-lg border transition-colors",
                                    current
                                        ? "bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/30"
                                        : "bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]",
                                )}
                            >
                                {current ? 'Sí — Envío gratis' : 'No — Envío gratis'}
                            </button>
                        )}
                    </div>
                );
            })}

            <div className="flex items-center gap-3 pt-1">
                <button
                    onClick={save}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[var(--accent)] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                    {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {saving ? 'Sincronizando…' : `Guardar y sincronizar a MeLi${changedFields.length ? ` (${changedFields.length})` : ''}`}
                </button>
            </div>

            {result && (
                <div className={cn(
                    "p-3 rounded-lg text-xs border",
                    failed.length === 0 && succeeded.length > 0 ? "bg-[var(--ok)]/10 border-[var(--ok)]/30 text-[var(--ok)]"
                        : "bg-[var(--err)]/10 border-[var(--err)]/30 text-[var(--err)]",
                )}>
                    {failed.length === 0 && succeeded.length > 0 ? (
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 shrink-0" /> Sincronizado correctamente.
                        </div>
                    ) : (
                        <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <div className="break-words">
                                {result.error && <span>{result.error}</span>}
                                {failed.length > 0 && (
                                    <ul className="mt-1 space-y-0.5">
                                        {failed.map((a) => (
                                            <li key={a.field}><strong>{a.field}</strong>: {a.error}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
