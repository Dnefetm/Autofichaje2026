'use client';
import { useState, useEffect, useRef } from 'react';

export function AutocompleteArticulo({ 
    value, 
    onChange, 
    placeholder = "Buscar artículo..." 
}: { 
    value: string; 
    onChange: (id: string) => void;
    placeholder?: string;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Initial value text
    useEffect(() => {
        if (value && !query) {
            setQuery(value); // or fetch item name if needed
        }
    }, [value]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!query || query === value) {
            setResults([]);
            return;
        }

        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                // To avoid creating a new API route, we'll hit the public Supabase from client if possible,
                // but since we need an API, we can use an existing endpoint or create a small one.
                // Actually, let's create a quick API route or just use supabase-js if we have it exposed.
                // Assuming `/api/catalog/search?q=` exists, or we just create it.
                const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    setResults(data.articulos || []);
                    setIsOpen(true);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [query]);

    return (
        <div ref={wrapperRef} className="relative w-full">
            <input 
                type="text"
                placeholder={placeholder}
                value={query}
                onChange={e => {
                    setQuery(e.target.value);
                    if (e.target.value === '') onChange('');
                }}
                onFocus={() => { if (results.length > 0) setIsOpen(true); }}
                className="border-[var(--border)] rounded-md text-sm shadow-sm focus:ring-[var(--accent)] focus:border-[var(--accent)] w-full px-2 py-1 border"
            />
            {loading && <div className="absolute right-2 top-1.5 text-xs text-[var(--text-faint)]">...</div>}
            
            {isOpen && results.length > 0 && (
                <div className="absolute z-50 mt-1 w-full max-w-sm bg-[var(--surface)] rounded-md shadow-lg border border-[var(--border)] max-h-60 overflow-auto">
                    {results.map(r => (
                        <div 
                            key={r.id} 
                            onClick={() => {
                                setQuery(r.codigo_universal || r.id);
                                onChange(r.id);
                                setIsOpen(false);
                            }}
                            className="px-3 py-2 hover:bg-[var(--accent)]/10 cursor-pointer border-b border-[var(--border)] last:border-0"
                        >
                            <div className="text-sm font-medium text-[var(--text)] truncate">{r.titulo || r.modelo}</div>
                            <div className="text-xs text-[var(--text-muted)] flex justify-between">
                                <span>{r.marca} - {r.modelo}</span>
                                <span>{r.codigo_universal}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
