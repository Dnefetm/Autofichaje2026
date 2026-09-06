import React from 'react';

// Badge de estado semántico (H4): verde=éxito, ámbar=advertencia, rojo=error, slate=neutro.
export function EstadoBadge({
    tono,
    children,
}: {
    tono: 'ok' | 'warn' | 'err' | 'neutro' | 'info';
    children: React.ReactNode;
}) {
    const map = {
        ok: 'bg-[var(--ok)]/15 text-[var(--ok)] border-[var(--ok)]/30',
        warn: 'bg-[var(--warn)]/15 text-[var(--warn)] border-[var(--warn)]/30',
        err: 'bg-[var(--err)]/15 text-[var(--err)] border-[var(--err)]/30',
        info: 'bg-[var(--info)]/15 text-[var(--info)] border-[var(--info)]/30',
        neutro: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
    } as const;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${map[tono]}`}>
            {children}
        </span>
    );
}
