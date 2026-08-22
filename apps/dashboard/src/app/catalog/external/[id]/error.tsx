'use client';
import { useEffect } from 'react';
import { AlertCircle } from 'lucide-react';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }, reset: () => void }) {
    useEffect(() => {
        console.error("Client Error in External Catalog:", error);
    }, [error]);

    return (
        <div className="flex-1 min-h-screen p-6 flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)]">
            <div className="bg-[var(--surface)] p-8 rounded-2xl border border-red-200 shadow-sm max-w-md w-full text-center">
                <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Error de Renderizado</h2>
                <p className="text-sm text-[var(--text-muted)] mb-6">
                    Se encontró un dato con formato inesperado que impidió mostrar la ficha.
                </p>
                <div className="bg-[var(--surface-2)] rounded p-3 text-left mb-6 overflow-auto max-h-32">
                    <p className="text-xs font-mono text-red-800 break-all">{error.message}</p>
                </div>
                <button 
                    onClick={() => reset()} 
                    className="px-5 py-2.5 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg font-medium hover:brightness-110 transition-colors w-full"
                >
                    Reintentar
                </button>
            </div>
        </div>
    );
}