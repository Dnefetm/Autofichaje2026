import React from 'react';

// Header compacto y consistente para TODAS las pantallas del módulo.
// Elimina las "letras grandes" (text-2xl/3xl) y cede el alto al área de trabajo.
export function PageHeader({
    titulo,
    subtitulo,
    acciones,
}: {
    titulo: string;
    subtitulo?: string;
    acciones?: React.ReactNode;
}) {
    return (
        <header className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
            <div className="flex items-center justify-between gap-3 min-w-0">
                <div className="min-w-0">
                    <h1 className="text-base font-bold text-[var(--text)] truncate leading-tight">{titulo}</h1>
                    {subtitulo && <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{subtitulo}</p>}
                </div>
                {acciones && <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">{acciones}</div>}
            </div>
        </header>
    );
}
