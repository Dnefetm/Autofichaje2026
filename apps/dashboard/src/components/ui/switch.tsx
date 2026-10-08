"use client";

import type { ReactNode } from 'react';

interface SwitchProps {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label?: ReactNode;
    disabled?: boolean;
    ariaLabel?: string;
}

/**
 * Switch — el ÚNICO toggle de la app.
 *
 * Posicionamiento por FLEXBOX (no absolute + translate): la perilla es un hijo
 * flex y se mueve con justify-start / justify-end. No depende de transform ni de
 * twMerge, por eso no se rompe con Tailwind v4.
 *
 * Tamaños por token fijo: pista h-6 w-11 (24×44px), perilla h-5 w-5 (20×20px),
 * padding px-0.5 (2px). ON = perilla a la derecha + verde; OFF = izquierda + gris.
 */
export function Switch({ checked, onCheckedChange, label, disabled, ariaLabel }: SwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={() => onCheckedChange(!checked)}
            className={`inline-flex items-center gap-2 select-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
            {label != null && <span className="text-xs text-[var(--text-muted)]">{label}</span>}
            <span
                aria-hidden="true"
                className={`flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${checked ? 'justify-end bg-[var(--ok)]' : 'justify-start bg-[var(--border)]'}`}
            >
                <span className="h-5 w-5 rounded-full bg-white shadow" />
            </span>
        </button>
    );
}
