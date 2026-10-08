"use client";

import { useState, useRef } from 'react';
import { Pencil, X, Check, Loader2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InlineFieldProps {
    pubId: string;
    fieldId: string;
    value: string | number | null | undefined;
    label?: string;
    /** texto legible al mostrar (p.ej. "Clásica (~16%)" en vez de "gold_special") */
    displayValue?: string;
    type?: 'text' | 'number' | 'select' | 'textarea';
    options?: Array<{ value: string; label: string }>;
    maxLength?: number;
    lockedReason?: string;
    valueClassName?: string;
    onSaved: (value: string) => void;
}

/**
 * InlineField — editor inline genérico (sin modal).
 * Muestra "etiqueta + valor" y, al hacer clic en el lápiz, se vuelve editor en el lugar.
 * Guarda vía PATCH /api/vitrinas/[id] y reporta el error por campo.
 * Si está bloqueado (lockedReason), muestra el valor + candado + motivo.
 */
export function InlineField({
    pubId,
    fieldId,
    value,
    label,
    displayValue,
    type = 'text',
    options,
    maxLength,
    lockedReason,
    valueClassName,
    onSaved,
}: InlineFieldProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(String(value ?? ''));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const display = displayValue ?? (value === null || value === undefined || value === '' ? '—' : String(value));

    const start = () => {
        setDraft(String(value ?? ''));
        setEditing(true);
        setError('');
        if (type !== 'textarea' && type !== 'select') setTimeout(() => inputRef.current?.focus(), 50);
    };
    const cancel = () => { setEditing(false); setError(''); };

    async function save() {
        if (saving) return;
        const next = draft.trim();
        if (next === String(value ?? '').trim()) { setEditing(false); return; }
        setSaving(true);
        setError('');
        try {
            const res = await fetch(`/api/vitrinas/${pubId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ changes: [{ field: fieldId, value: next }] }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error al sincronizar');
            const r = Array.isArray(data.applied) ? data.applied.find((a: any) => a.field === fieldId) : null;
            if (r && !r.ok) throw new Error(r.error || 'MeLi rechazó el cambio');
            onSaved(next);
            setEditing(false);
        } catch (e: any) {
            setError(e?.message || 'Error al guardar');
        } finally {
            setSaving(false);
        }
    }

    const labelCell = label ? (
        <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider shrink-0 w-36">{label}</span>
    ) : null;

    if (lockedReason) {
        return (
            <div className="flex items-start justify-between py-1.5 border-b border-[var(--border)] last:border-0 gap-2">
                {labelCell}
                <div className="flex items-center gap-2 text-right flex-1 min-w-0">
                    <span className={cn('text-sm text-[var(--text-muted)] break-words flex-1 min-w-0', valueClassName)}>{display}</span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-faint)] shrink-0">
                        <Lock className="w-3 h-3" />
                        {lockedReason}
                    </span>
                </div>
            </div>
        );
    }

    if (editing) {
        return (
            <div className="flex items-start justify-between py-1.5 border-b border-[var(--border)] last:border-0 gap-2">
                {labelCell}
                <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1.5">
                        {type === 'select' ? (
                            <select
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                className="flex-1 h-9 text-sm border-2 border-[var(--accent)]/70 rounded-[var(--radius)] px-2 bg-[var(--surface)]"
                            >
                                {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        ) : type === 'textarea' ? (
                            <textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                rows={5}
                                maxLength={maxLength}
                                className="flex-1 w-full text-sm border-2 border-[var(--accent)]/70 rounded-[var(--radius)] px-2 py-1 resize-y"
                            />
                        ) : (
                            <input
                                ref={inputRef}
                                type={type}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                maxLength={maxLength}
                                onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
                                className="flex-1 h-9 text-sm border-2 border-[var(--accent)]/70 rounded-[var(--radius)] px-2 font-mono"
                            />
                        )}
                        {saving ? (
                            <Loader2 className="w-4 h-4 animate-spin shrink-0 mt-1" />
                        ) : (
                            <>
                                <button onClick={save} className="p-1.5 bg-[var(--accent)] text-[var(--accent-ink)] rounded-[var(--radius-sm)] shrink-0" title="Guardar"><Check className="w-3.5 h-3.5" /></button>
                                <button onClick={cancel} className="p-1.5 bg-[var(--surface-2)] text-[var(--text-muted)] rounded-[var(--radius-sm)] shrink-0" title="Cancelar"><X className="w-3.5 h-3.5" /></button>
                            </>
                        )}
                    </div>
                    {maxLength != null && <span className="text-[10px] text-[var(--text-faint)] tabular-nums">{draft.length}/{maxLength}</span>}
                    {error && <p className="text-[10px] text-[var(--err)] break-words">{error}</p>}
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-start justify-between py-1.5 border-b border-[var(--border)] last:border-0 gap-2 group">
            {labelCell}
            <div className="flex items-center gap-2 text-right flex-1 min-w-0">
                <span className={cn('text-sm text-[var(--text)] break-words flex-1 min-w-0', valueClassName)}>{display}</span>
                <button onClick={start} className="p-1 rounded hover:bg-[var(--surface-2)] text-[var(--text-faint)] hover:text-[var(--accent)] shrink-0" title={`Editar ${label || fieldId}`}>
                    <Pencil className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
