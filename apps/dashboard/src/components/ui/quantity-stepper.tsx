"use client";

import { useState } from 'react';

interface Props {
    value: number;
    onChange: (n: number) => void;
    min?: number;
    /** si false, solo renderiza el input (sin botones -/+), para campos sueltos */
    showButtons?: boolean;
    className?: string;
    inputClassName?: string;
}

/**
 * QuantityStepper — input de cantidad que SÍ se puede vaciar.
 *
 * Guarda un borrador en texto local (permite campo vacío) y recién al salir del
 * campo (blur) o presionar Enter lo convierte y lo fija en >= min. Así podés
 * borrar el "1" y escribir "3" sin que vuelva a aparecer un dígito.
 */
export function QuantityStepper({ value, onChange, min = 1, showButtons = true, className, inputClassName }: Props) {
    const [draft, setDraft] = useState(String(value));
    const [prev, setPrev] = useState(value);
    // Sincroniza el borrador solo cuando el valor externo cambia (botones -/+, guardado, recarga).
    if (value !== prev) {
        setPrev(value);
        setDraft(String(value));
    }

    function commit() {
        const n = parseInt(draft, 10);
        if (!isNaN(n) && n >= min) onChange(n);
        else setDraft(String(value));
    }
    function step(dir: 1 | -1) {
        const n = parseInt(draft, 10);
        const base = isNaN(n) ? value : n;
        const next = Math.max(min, base + dir);
        onChange(next);
        setDraft(String(next));
    }

    const input = (
        <input
            type="text"
            inputMode="numeric"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
            className={`h-full text-center text-xs font-bold bg-transparent border-none appearance-none p-0 focus:ring-0 text-[var(--text)] w-12 ${inputClassName || ''}`}
        />
    );

    if (!showButtons) {
        return (
            <div className={`flex items-center border border-[var(--border)] bg-[var(--surface-2)] rounded overflow-hidden h-8 ${className || ''}`}>
                {input}
            </div>
        );
    }

    return (
        <div className={`flex items-center border border-[var(--border)] bg-[var(--surface-2)] rounded-lg overflow-hidden h-7 ${className || ''}`}>
            <button onClick={() => step(-1)} className="w-9 h-full flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] font-bold transition-colors">-</button>
            {input}
            <button onClick={() => step(1)} className="w-9 h-full flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] font-bold transition-colors">+</button>
        </div>
    );
}
