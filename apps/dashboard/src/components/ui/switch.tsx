"use client";

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
 * Tamaños por token fijo, derivados entre sí (no hay píxeles mágicos por instancia):
 *   pista   = h-6 w-11 (24×44px)
 *   perilla = h-5 w-5   (20×20px), left-0.5/top-0.5 (2px de margen)
 *   recorrido = translate-x-5 (20px = 44 − 20 − 2 − 2)
 *
 * Accesible: role="switch", aria-checked, foco visible, se opera con clic o teclado
 * (Espacio) porque es un <button> nativo.
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
            className={cn(
                'inline-flex items-center gap-2 select-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]',
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
            )}
        >
            {label != null && <span className="text-xs text-[var(--text-muted)]">{label}</span>}
            <span
                aria-hidden="true"
                className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                    checked ? 'bg-[var(--ok)]' : 'bg-[var(--border)]',
                )}
            >
                <span
                    className={cn(
                        'pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                        checked ? 'translate-x-5' : 'translate-x-0',
                    )}
                />
            </span>
        </button>
    );
}
