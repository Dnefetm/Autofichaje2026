"use client";
import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Search, Link2 } from 'lucide-react';

/**
 * Modal para vincular un artículo del catálogo maestro a una vidriera (publicación)
 * existente en MeLi. Dirección inversa a la cola de pendientes.
 */
export default function VincularVitrinaModal({
  articuloId,
  articuloNombre,
  onClose,
  onSuccess,
}: {
  articuloId: string;
  articuloNombre: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [vinculando, setVinculando] = useState<string | null>(null);

  async function buscar() {
    const q = search.trim();
    if (q.length < 2) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('publicaciones_externas')
        .select('id, external_item_id, titulo, precio_venta, esta_mapeado, tipo_publicacion, status_externo')
        .or(`titulo.ilike.%${q}%,external_item_id.ilike.%${q}%,seller_sku.ilike.%${q}%`)
        .eq('external_variation_id', '0')
        .limit(20);
      setResults(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function vincular(pubId: string) {
    setVinculando(pubId);
    try {
      const res = await fetch('/api/vinculacion/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicacion_id: pubId, articulo_id: articuloId, cantidad_requerida: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      onSuccess();
      onClose();
    } catch (e: any) {
      alert(e.message || 'Error al vincular');
    } finally {
      setVinculando(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[80dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--text)]">Vincular a vidriera</h2>
            <p className="text-xs text-[var(--text-muted)] truncate max-w-xs">{articuloNombre}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--surface-2)] text-[var(--text-muted)] rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-2 border-b border-[var(--border)] shrink-0 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-faint)]" />
            <input
              autoFocus
              className="w-full pl-9 pr-3 py-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)] focus:ring-2 focus:ring-[var(--accent)] outline-none"
              placeholder="Busca por título o MLM (ej. MLM1234567890)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscar()}
            />
          </div>
          <button onClick={buscar} className="px-3 py-2 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg text-sm font-semibold">
            Buscar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <p className="text-sm text-[var(--text-muted)] text-center py-4">Buscando…</p>}
          {!loading && results.length === 0 && (
            <p className="text-sm text-[var(--text-faint)] text-center py-8">Escribe y presiona Buscar para encontrar la vidriera.</p>
          )}
          {results.map((p) => (
            <div key={p.id} className="p-3 bg-[var(--surface-2)]/50 border border-[var(--border)] rounded-lg flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--text)] truncate">{p.titulo}</p>
                <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
                  {p.external_item_id} · ${p.precio_venta?.toLocaleString?.('es-MX') ?? p.precio_venta}
                  {p.esta_mapeado ? ' · ya mapeada' : ''}
                </p>
              </div>
              <button
                onClick={() => vincular(p.id)}
                disabled={vinculando === p.id}
                className="shrink-0 px-3 py-1.5 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1"
              >
                {vinculando === p.id ? 'Vinculando…' : <><Link2 className="w-4 h-4" /> Vincular</>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
