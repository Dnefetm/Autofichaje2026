"use client";
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Search, Link2, RefreshCw } from 'lucide-react';

function norm(s?: string | null): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function normCode(s?: string | null): string {
  return (s || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
}

interface Vitrina {
  id: string;
  external_item_id: string;
  titulo: string;
  precio_venta: number | null;
  brand: string | null;
  model: string | null;
  seller_sku: string | null;
  esta_mapeado: boolean | null;
  tipo_publicacion: string | null;
  _metodo?: string;
  _score?: number;
}

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
  const [results, setResults] = useState<Vitrina[]>([]);
  const [sugerencias, setSugerencias] = useState<Vitrina[]>([]);
  const [loadingSug, setLoadingSug] = useState(true);
  const [loading, setLoading] = useState(false);
  const [vinculando, setVinculando] = useState<string | null>(null);

  useEffect(() => {
    cargarSugerencias();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articuloId]);

  async function cargarSugerencias() {
    setLoadingSug(true);
    try {
      const { data: art } = await supabase
        .from('articulos')
        .select('articulo_id, nombre, marca, modelo, codigo_universal')
        .eq('articulo_id', articuloId)
        .single();
      if (!art) { setLoadingSug(false); return; }

      const modelo = norm(art.modelo);
      const marca = norm(art.marca);
      const codigo = normCode(art.codigo_universal);

      // Señales exactas contra publicaciones sin mapear (mismo criterio que la cola)
      const exactParts: string[] = [];
      if (art.articulo_id) exactParts.push(`seller_sku.eq.${art.articulo_id}`, `model.eq.${art.articulo_id}`);
      if (modelo) exactParts.push(`model.eq.${modelo}`, `seller_sku.eq.${modelo}`);
      if (codigo) exactParts.push(`ean.eq.${codigo}`, `gtin.eq.${codigo}`, `upc.eq.${codigo}`);

      let exactos: any[] = [];
      if (exactParts.length) {
        const { data } = await supabase
          .from('publicaciones_externas')
          .select('id, external_item_id, titulo, precio_venta, brand, model, seller_sku, esta_mapeado, tipo_publicacion')
          .or('esta_mapeado.is.null,esta_mapeado.eq.false')
          .not('es_bundle', 'is', true)
          .not('tags', 'cs', '{bundle}')
          .eq('external_variation_id', '0')
          .or(exactParts.join(','))
          .limit(30);
        exactos = (data || []).map((p) => ({ ...p, _score: 100, _metodo: 'Coincidencia exacta' }));
      }

      // Fuzzy por tokens del nombre del artículo
      let fuzzy: any[] = [];
      const tokens = norm(art.nombre).split(/\s+/).filter((t) => t.length >= 4).slice(0, 3);
      if (tokens.length) {
        const parts = tokens.map((t) => `titulo.ilike.%${t}%`);
        const { data } = await supabase
          .from('publicaciones_externas')
          .select('id, external_item_id, titulo, precio_venta, brand, model, seller_sku, esta_mapeado, tipo_publicacion')
          .or('esta_mapeado.is.null,esta_mapeado.eq.false')
          .not('es_bundle', 'is', true)
          .not('tags', 'cs', '{bundle}')
          .eq('external_variation_id', '0')
          .or(parts.join(','))
          .limit(30);
        fuzzy = (data || []).map((p) => ({ ...p, _score: 60, _metodo: 'Similitud de título' }));
      }

      // Deduplicar (exacto gana sobre fuzzy) y ordenar por score
      const map = new Map<string, Vitrina>();
      for (const p of [...exactos, ...fuzzy]) {
        const prev = map.get(p.id);
        if (!prev || p._score > prev._score!) map.set(p.id, p);
      }
      setSugerencias(Array.from(map.values()).sort((a, b) => (b._score || 0) - (a._score || 0)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSug(false);
    }
  }

  async function buscar() {
    const q = search.trim();
    if (q.length < 2) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('publicaciones_externas')
        .select('id, external_item_id, titulo, precio_venta, brand, model, seller_sku, esta_mapeado, tipo_publicacion')
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

  function Fila({ p }: { p: Vitrina }) {
    return (
      <div className="p-3 bg-[var(--surface-2)]/50 border border-[var(--border)] rounded-lg flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--text)] truncate">{p.titulo}</p>
          <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">
            {p.external_item_id} · ${p.precio_venta?.toLocaleString?.('es-MX') ?? p.precio_venta}
            {p.esta_mapeado ? ' · ya mapeada' : ''}
          </p>
          {p._metodo && (
            <span className="inline-block mt-1 text-[11px] font-bold text-[var(--ok)]">{p._metodo}</span>
          )}
        </div>
        <button
          onClick={() => vincular(p.id)}
          disabled={vinculando === p.id}
          className="shrink-0 px-3 py-1.5 bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1"
        >
          {vinculando === p.id ? 'Vinculando…' : <><Link2 className="w-4 h-4" /> Vincular</>}
        </button>
      </div>
    );
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
              className="w-full pl-9 pr-3 py-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)] focus:ring-2 focus:ring-[var(--accent)] outline-none"
              placeholder="Busca por título o MLM si no aparece en sugeridas"
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
          {search.trim().length >= 2 ? (
            <>
              {loading && <p className="text-sm text-[var(--text-muted)] text-center py-4">Buscando…</p>}
              {!loading && results.length === 0 && (
                <p className="text-sm text-[var(--text-faint)] text-center py-8">Sin resultados.</p>
              )}
              {results.map((p) => <Fila key={p.id} p={p} />)}
            </>
          ) : (
            <>
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--ok)]">
                Vidrieras sugeridas ({sugerencias.length})
              </p>
              {loadingSug && (
                <p className="text-sm text-[var(--text-muted)] text-center py-4 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Buscando compatibles…
                </p>
              )}
              {!loadingSug && sugerencias.length === 0 && (
                <p className="text-sm text-[var(--text-faint)] text-center py-8">
                  No se encontraron vidrieras sugeridas. Usa el buscador.
                </p>
              )}
              {sugerencias.map((p) => <Fila key={p.id} p={p} />)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
