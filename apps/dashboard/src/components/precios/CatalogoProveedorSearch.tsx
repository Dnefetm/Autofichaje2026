'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Loader2 } from 'lucide-react';

/**
 * Buscador de la lista de precios del proveedor.
 * - Automático: dispara la búsqueda mientras se escribe (debounce 250 ms).
 * - Inmediato: navegación cliente (router.replace) sin recarga completa de página;
 *   el server component re-renderiza con el nuevo `q` y muestra un spinner.
 */
export function CatalogoProveedorSearch({
    proveedor,
    initialQ,
}: {
    proveedor: string;
    initialQ?: string;
}) {
    const router = useRouter();
    const [q, setQ] = useState(initialQ || '');
    const [isPending, startTransition] = useTransition();
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const base = `/precios/${encodeURIComponent(proveedor)}`;

    // Sincroniza si cambia la URL (ej. botón atrás/adelante del navegador).
    useEffect(() => {
        setQ(initialQ || '');
    }, [initialQ]);

    // Limpia el debounce pendiente al desmontar.
    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, []);

    const navigate = (query: string) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            const clean = query.trim();
            const href = clean ? `${base}?q=${encodeURIComponent(clean)}` : base;
            startTransition(() => router.replace(href, { scroll: false }));
        }, 250);
    };

    const clear = () => {
        setQ('');
        if (debounceRef.current) clearTimeout(debounceRef.current);
        startTransition(() => router.replace(base, { scroll: false }));
    };

    return (
        <div className="relative w-full max-w-xl">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-[var(--text-faint)] pointer-events-none" />
            <input
                type="text"
                value={q}
                onChange={(e) => {
                    setQ(e.target.value);
                    navigate(e.target.value);
                }}
                placeholder="Buscar por modelo, código universal o descripción..."
                className="pl-10 pr-16 py-2.5 w-full text-sm border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent)] bg-[var(--bg)]/50"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {isPending && <Loader2 className="w-4 h-4 text-[var(--text-faint)] animate-spin" />}
                {q && (
                    <button
                        onClick={clear}
                        className="text-[var(--text-muted)] hover:text-[var(--text)] p-1 rounded"
                        title="Limpiar"
                        aria-label="Limpiar búsqueda"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    );
}
