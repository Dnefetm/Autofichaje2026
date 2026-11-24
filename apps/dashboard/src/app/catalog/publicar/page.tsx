"use client";

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Search, X, Send, Loader2, ArrowLeft, Package } from 'lucide-react';
import { Page } from '@/components/ui/Page';
import { PageHeader } from '@/components/ui/PageHeader';
import { PublishPanel } from '@/components/publish-panel';
import { supabase } from '@/lib/supabase';

interface ArticuloSearchItem {
    articulo_id: string;
    nombre: string;
    marca?: string | null;
    modelo?: string | null;
    variante?: string | null;
    codigo_universal?: string | null;
}

export default function PublicarDesdeCeroPage() {
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [results, setResults] = useState<ArticuloSearchItem[]>([]);
    const [selectedArt, setSelectedArt] = useState<ArticuloSearchItem | null>(null);
    const [selectedArtImages, setSelectedArtImages] = useState<string[]>([]);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            setResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        timerRef.current = setTimeout(async () => {
            try {
                const res = await fetch(`/api/articulos/buscar?query=${encodeURIComponent(trimmed)}&limit=10`);
                const data = await res.json();
                setResults(Array.isArray(data?.items) ? data.items : []);
            } catch {
                setResults([]);
            } finally {
                setSearching(false);
            }
        }, 300);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [query]);

    async function handleSelectArticulo(item: ArticuloSearchItem) {
        setSelectedArt(item);
        setResults([]);
        setQuery('');
        setSelectedArtImages([]);
        try {
            const { data } = await supabase
                .from('articulos')
                .select('imagenes')
                .eq('articulo_id', item.articulo_id)
                .single();
            if (Array.isArray(data?.imagenes)) {
                setSelectedArtImages(data.imagenes.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0));
            }
        } catch {
            // Opcional: si falla la lectura de imágenes, el usuario igual puede agregar fotos en el panel
        }
    }

    function clearSelectedArticulo() {
        setSelectedArt(null);
        setSelectedArtImages([]);
        setQuery('');
        setResults([]);
    }

    return (
        <div className="flex-1 overflow-auto bg-[var(--bg)] min-h-screen">
            <Page>
                <PageHeader
                    title={
                        <span className="inline-flex items-center gap-2">
                            <Send className="w-5 h-5 text-[var(--accent)]" />
                            Publicar en Mercado Libre
                        </span>
                    }
                    description="Crea una publicación desde 0 sin depender del Catálogo Maestro, o busca un artículo existente para pre-llenar."
                    actions={
                        <Link
                            href="/catalog/external"
                            className="touch-target inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors px-3 py-2 text-sm bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--surface-2)]"
                        >
                            <ArrowLeft className="w-4 h-4" /> Ver Vitrinas MeLi
                        </Link>
                    }
                />

                {/* Pre-llenado opcional desde Catálogo Maestro */}
                <div className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4 space-y-3 shadow-sm">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                            <h2 className="text-xs font-bold uppercase text-[var(--text-faint)] tracking-wider">
                                ¿Ya existe en Catálogo Maestro? (opcional)
                            </h2>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">
                                Si es un producto nuevo, ignora este cuadro y llena los campos directamente abajo.
                            </p>
                        </div>
                        {selectedArt && (
                            <button
                                type="button"
                                onClick={clearSelectedArticulo}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-lg hover:bg-[var(--err)]/20 transition-colors shrink-0"
                            >
                                <X className="w-3.5 h-3.5" /> Volver a publicar desde 0
                            </button>
                        )}
                    </div>

                    {selectedArt ? (
                        <div className="flex items-center gap-2.5 p-2.5 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-xs">
                            <Package className="w-4 h-4 text-[var(--accent)] shrink-0" />
                            <div className="min-w-0 flex-1">
                                <span className="font-semibold text-[var(--accent)]">Pre-llenado desde Catálogo Maestro:</span>{' '}
                                <span className="font-bold text-[var(--text)]">{selectedArt.nombre}</span>{' '}
                                <span className="font-mono text-[10px] text-[var(--text-faint)]">({selectedArt.articulo_id})</span>
                            </div>
                        </div>
                    ) : (
                        <div className="relative">
                            <div className="flex items-center gap-2 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--bg)] focus-within:ring-2 focus-within:ring-[var(--accent)]">
                                <Search className="w-4 h-4 text-[var(--text-faint)] shrink-0" />
                                <input
                                    type="text"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    placeholder="Buscar artículo existente por nombre, marca, modelo o código de barras..."
                                    className="flex-1 text-sm bg-transparent outline-none placeholder:text-[var(--text-faint)]"
                                />
                                {searching && <Loader2 className="w-4 h-4 animate-spin text-[var(--text-faint)] shrink-0" />}
                            </div>

                            {results.length > 0 && (
                                <div className="absolute z-40 left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-lg max-h-64 overflow-y-auto divide-y divide-[var(--border)]">
                                    {results.map(item => (
                                        <button
                                            key={item.articulo_id}
                                            type="button"
                                            onClick={() => handleSelectArticulo(item)}
                                            className="w-full text-left px-3 py-2.5 hover:bg-[var(--accent)]/10 transition-colors flex items-center justify-between gap-3"
                                        >
                                            <div className="min-w-0">
                                                <p className="text-xs font-semibold text-[var(--text)] truncate">{item.nombre}</p>
                                                <p className="text-[11px] text-[var(--text-faint)] truncate">
                                                    {[item.marca, item.modelo, item.codigo_universal].filter(Boolean).join(' · ') || 'Sin detalles adicionales'}
                                                </p>
                                            </div>
                                            <span className="text-[10px] font-mono text-[var(--text-faint)] shrink-0">{item.articulo_id}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Motor unificado de publicación */}
                <div className="max-w-3xl">
                    <PublishPanel
                        key={selectedArt?.articulo_id || 'standalone'}
                        modalMode
                        standaloneMode={!selectedArt}
                        articulo_id={selectedArt?.articulo_id}
                        nombreArticulo={selectedArt?.nombre || ''}
                        codigoUniversal={selectedArt?.codigo_universal || ''}
                        imagenesBase={selectedArtImages}
                    />
                </div>
            </Page>
        </div>
    );
}
