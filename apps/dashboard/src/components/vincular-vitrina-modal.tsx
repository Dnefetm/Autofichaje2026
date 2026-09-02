"use client";
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';
import { X, Search, Link2, Save, RefreshCw, Plus, Info, Package } from 'lucide-react';
import ComparacionArticuloVitrina from './comparacion-articulo-vitrina';

interface ArticuloInfo {
  articulo_id: string;
  nombre: string;
  marca: string | null;
  modelo: string | null;
  codigo_universal: string | null;
  caja_madre: string | null;
  thumbnail?: string | null;
}

interface Vitrina {
  id: string;
  external_item_id: string | null;
  titulo: string | null;
  brand: string | null;
  model: string | null;
  seller_sku: string | null;
  precio_venta: number | null;
  ean?: string | null;
  gtin?: string | null;
  upc?: string | null;
  esta_mapeado?: boolean | null;
  score?: number;
  motivo?: string;
}

interface PubSel extends Vitrina {
  quantity: number;
}

export default function VincularVitrinaModal({
  articulo,
  onClose,
  onSuccess,
}: {
  articulo: ArticuloInfo;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Vitrina[]>([]);
  const [selectedPubs, setSelectedPubs] = useState<PubSel[]>([]);
  const [suggestions, setSuggestions] = useState<Vitrina[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [topSugerencia, setTopSugerencia] = useState<Vitrina | null>(null);
  const [existingLinks, setExistingLinks] = useState<Vitrina[]>([]);
  const [costOk, setCostOk] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  const artCodigo = articulo.codigo_universal || '';

  useEffect(() => {
    cargarSugerencias();
    cargarExistentes();
    cargarCosto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articulo.articulo_id]);

  async function cargarSugerencias() {
    setSuggestionsLoading(true);
    try {
      const res = await fetch(`/api/vinculacion/sugerencias-vitrinas?articulo_id=${encodeURIComponent(articulo.articulo_id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      const rows: Vitrina[] = data.rows || [];
      setSuggestions(rows);
      const top = rows[0];
      setTopSugerencia(top && top.score != null && top.score >= 80 ? top : null);
    } catch (e) {
      console.error(e);
      setSuggestions([]);
      setTopSugerencia(null);
    } finally {
      setSuggestionsLoading(false);
    }
  }

  async function cargarExistentes() {
    try {
      const { data } = await supabase
        .from('mapeo_publicacion_articulo')
        .select(`publicacion_id, publicaciones_externas(external_item_id, titulo, precio_venta)`)
        .eq('articulo_id', articulo.articulo_id);
      const rows: Vitrina[] = (data || [])
        .map((m: any) => {
          const p = m.publicaciones_externas;
          return {
            id: m.publicacion_id,
            external_item_id: p?.external_item_id ?? null,
            titulo: p?.titulo ?? null,
            brand: null,
            model: null,
            seller_sku: null,
            precio_venta: p?.precio_venta ?? null,
          };
        })
        .filter((r: Vitrina) => r.id);
      setExistingLinks(rows);
    } catch (e) {
      console.error(e);
    }
  }

  async function cargarCosto() {
    try {
      const { data } = await supabase
        .from('costos_articulo')
        .select('articulo_id')
        .eq('articulo_id', articulo.articulo_id)
        .eq('vigente', true)
        .limit(1);
      setCostOk(!!(data && data.length));
    } catch {
      setCostOk(null);
    }
  }

  async function desvincular(publicacionId: string) {
    try {
      await supabase
        .from('mapeo_publicacion_articulo')
        .delete()
        .eq('publicacion_id', publicacionId)
        .eq('articulo_id', articulo.articulo_id);
      const { data } = await supabase
        .from('mapeo_publicacion_articulo')
        .select('id')
        .eq('publicacion_id', publicacionId)
        .limit(1);
      if (!data || data.length === 0) {
        await supabase.from('publicaciones_externas').update({ esta_mapeado: false }).eq('id', publicacionId);
      }
      cargarExistentes();
      cargarSugerencias();
    } catch (e) {
      console.error(e);
      alert('Error al desvincular');
    }
  }

  // Búsqueda con debounce sobre título / MLM / SKU / marca / modelo / EAN
  useEffect(() => {
    const debounce = setTimeout(() => {
      if (searchTerm.trim().length >= 2) buscar(searchTerm.trim());
      else setSearchResults([]);
    }, 300);
    return () => clearTimeout(debounce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  async function buscar(q: string) {
    try {
      const { data } = await supabase
        .from('publicaciones_externas')
        .select('id, external_item_id, titulo, brand, model, seller_sku, precio_venta, ean, gtin, upc, esta_mapeado')
        .or(`titulo.ilike.%${q}%,external_item_id.ilike.%${q}%,seller_sku.ilike.%${q}%,brand.ilike.%${q}%,model.ilike.%${q}%,ean.ilike.%${q}%,gtin.ilike.%${q}%`)
        .eq('external_variation_id', '0')
        .limit(20);
      setSearchResults(data || []);
    } catch (e) {
      console.error(e);
      setSearchResults([]);
    }
  }

  function addPub(p: Vitrina) {
    if (selectedPubs.find((s) => s.id === p.id)) return;
    setSelectedPubs((prev) => [
      ...prev,
      {
        id: p.id,
        external_item_id: p.external_item_id ?? '',
        titulo: p.titulo ?? '',
        brand: p.brand ?? null,
        model: p.model ?? null,
        seller_sku: p.seller_sku ?? null,
        precio_venta: p.precio_venta ?? null,
        ean: p.ean ?? null,
        gtin: p.gtin ?? null,
        upc: p.upc ?? null,
        quantity: 1,
      },
    ]);
  }

  function removePub(id: string) {
    setSelectedPubs((prev) => prev.filter((s) => s.id !== id));
  }

  function changeQuantity(id: string, qty: number) {
    if (qty < 1) return;
    setSelectedPubs((prev) => prev.map((s) => (s.id === id ? { ...s, quantity: qty } : s)));
  }

  async function guardar() {
    if (selectedPubs.length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/vinculacion/confirmar-lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vinculos: selectedPubs.map((p) => ({
            publicacion_id: p.id,
            articulo_id: articulo.articulo_id,
            cantidad_requerida: p.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      dispatchWorker();
      onSuccess();
      onClose();
    } catch (e: any) {
      alert(e.message || 'Error al vincular');
    } finally {
      setSaving(false);
    }
  }

  const filteredSuggestions = suggestions.filter(
    (s) => !selectedPubs.find((sel) => sel.id === s.id) && !existingLinks.find((el) => el.id === s.id),
  );

  function SuggestionRow({ p }: { p: Vitrina }) {
    return (
      <button
        onClick={() => addPub(p)}
        className="w-full text-left p-3 rounded-lg bg-[var(--surface-2)]/50 hover:bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all flex items-center justify-between group"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text)] truncate">{p.titulo}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {p.score != null && p.score >= 90 && (
              <span className="text-xs bg-[var(--ok)]/20 text-[var(--ok)] border border-[var(--ok)]/40 px-1.5 py-0.5 rounded-full font-bold">Match Alto</span>
            )}
            {p.score != null && p.score >= 60 && p.score < 90 && (
              <span className="text-xs bg-[var(--warn)]/20 text-[var(--warn)] border border-[var(--warn)]/40 px-1.5 py-0.5 rounded-full font-semibold">Match Medio</span>
            )}
            {p.brand && <span className="text-xs text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">{p.brand}</span>}
            {(p.ean || p.gtin || p.upc) && (
              <span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                Cod: {p.ean || p.gtin || p.upc}
              </span>
            )}
            {p.motivo && <span className="text-xs text-[var(--ok)]">{p.motivo}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 ml-3 shrink-0">
          <span className="text-xs font-mono text-[var(--text-faint)]">{p.external_item_id}</span>
          <div className="w-9 h-9 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center group-hover:bg-[var(--accent)] group-hover:border-[var(--accent)] transition-colors">
            <Plus size={12} className="text-[var(--text-muted)] group-hover:text-[var(--accent-ink)]" />
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-6xl h-[85dvh] max-h-[850px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0">
          <h2 className="text-sm font-bold text-[var(--text)]">Vincular a Vidriera</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Banner de contexto del Artículo */}
        <div className="border-b border-[var(--border)] bg-[var(--surface-2)]/30 shrink-0">
          <div className="px-4 py-1.5 flex items-center gap-2">
            {articulo.thumbnail && (
              <img src={articulo.thumbnail} alt="Thumbnail" className="w-7 h-7 object-contain rounded-md bg-white border border-[var(--border)] shrink-0" />
            )}
            <div className="flex-1 min-w-0 flex items-center gap-2 text-xs flex-wrap">
              <span className="font-semibold text-[var(--text)] truncate" title={articulo.nombre}>{articulo.nombre}</span>
              <span className="text-[var(--text-muted)] font-mono shrink-0">{articulo.articulo_id}</span>
              {articulo.marca && <span className="text-[var(--text-muted)] shrink-0">Marca: {articulo.marca}</span>}
              {articulo.modelo && <span className="text-[var(--text-muted)] font-mono shrink-0">Mod: {articulo.modelo}</span>}
              {artCodigo && <span className="text-[var(--text-muted)] font-mono shrink-0">Cod: {artCodigo}</span>}
              {costOk !== null && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded border shrink-0 ${costOk ? 'bg-[var(--ok)]/10 text-[var(--ok)] border-[var(--ok)]/20' : 'bg-[var(--err)]/10 text-[var(--err)] border-[var(--err)]/20'}`}>
                  {costOk ? 'Costo OK' : 'Sin Costo'}
                </span>
              )}
              {articulo.caja_madre && (
                <span className="text-xs font-bold text-[var(--warn)] bg-[var(--warn)]/10 px-1.5 py-0.5 rounded border border-[var(--warn)]/30 shrink-0">Caja madre: {articulo.caja_madre}</span>
              )}
            </div>
          </div>

          {existingLinks.length > 0 && (
            <div className="px-6 py-2 bg-[var(--surface-2)] flex items-center gap-1.5 border-t border-[var(--border)]">
              <Info size={14} className="text-[var(--accent)] shrink-0" />
              <span className="text-[var(--accent)] text-xs">
                Ya vinculada a <strong>{existingLinks.length}</strong> vidriera(s). Las nuevas se sumarán al ensamble de esta publicación.
              </span>
            </div>
          )}
        </div>

        {/* BODY: 2 columnas */}
        <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden bg-[var(--surface)]">
          {/* LEFT: sugerencias + búsqueda (60%) */}
          <div className="w-full md:w-[60%] shrink-0 flex flex-col md:border-r border-[var(--border)] overflow-hidden">
            {topSugerencia && !searchTerm && (
              <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]/30 shrink-0">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--ok)]">
                    Coincidencia {topSugerencia.score}% · {topSugerencia.motivo}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    {(() => {
                      const s = selectedPubs.find((x) => x.id === topSugerencia.id);
                      return s ? (
                        <>
                          <span className="text-xs text-[var(--text-muted)]">Cantidad:</span>
                          <div className="flex items-center border border-[var(--border)] bg-[var(--surface-2)] rounded-lg overflow-hidden h-9">
                            <button onClick={() => changeQuantity(s.id, s.quantity - 1)} className="w-9 h-full flex items-center justify-center text-[var(--text)] font-bold hover:bg-[var(--surface)]">-</button>
                            <input type="number" value={s.quantity} onChange={(e) => changeQuantity(s.id, Math.max(1, parseInt(e.target.value) || 1))} className="w-12 h-full text-center text-sm font-bold bg-transparent border-none p-0 focus:ring-0 text-[var(--text)]" />
                            <button onClick={() => changeQuantity(s.id, s.quantity + 1)} className="w-9 h-full flex items-center justify-center text-[var(--text)] font-bold hover:bg-[var(--surface)]">+</button>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => addPub(topSugerencia)}
                          className="px-3 py-1.5 bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-semibold rounded-lg hover:brightness-110"
                        >
                          Añadir
                        </button>
                      );
                    })()}
                  </div>
                </div>
                <ComparacionArticuloVitrina
                  articulo={articulo}
                  vitrina={{
                    titulo: topSugerencia.titulo,
                    brand: topSugerencia.brand,
                    model: topSugerencia.model,
                    seller_sku: topSugerencia.seller_sku,
                    codigo: topSugerencia.gtin || topSugerencia.ean || topSugerencia.upc,
                  }}
                />
              </div>
            )}

            <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 shadow-sm relative z-10">
              <label className="text-xs font-semibold text-[var(--text-muted)] mb-1.5 block">Buscar vidriera</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" size={16} />
                <input
                  type="text"
                  className="w-full pl-10 pr-4 py-2.5 bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-all outline-none text-sm placeholder:text-[var(--text-faint)]"
                  placeholder="Busca por título, MLM, SKU, marca, modelo, código..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-[var(--surface)] space-y-4 max-h-[45vh] md:max-h-none">
              {searchResults.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-[var(--text)] mb-2">Resultados de búsqueda</h4>
                  {searchResults.map((res) => <SuggestionRow key={res.id} p={res} />)}
                </div>
              ) : (suggestionsLoading || filteredSuggestions.length > 0) ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-[var(--text-muted)] flex items-center gap-1.5 mb-2">
                    <RefreshCw size={12} className={suggestionsLoading ? 'animate-spin' : ''} />
                    {suggestionsLoading ? 'Analizando similitudes...' : `${filteredSuggestions.length} vidrieras sugeridas`}
                  </h4>
                  {!suggestionsLoading && filteredSuggestions.map((res) => <SuggestionRow key={res.id} p={res} />)}
                </div>
              ) : (
                <div className="text-center py-10 text-[var(--text-faint)]">
                  <Search size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No hay vidrieras sugeridas. Usa el buscador.</p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: seleccionadas (40%) */}
          <div className="w-full md:w-[40%] shrink-0 flex flex-col bg-[var(--surface-2)]/30 border-t md:border-t-0 md:border-l border-[var(--border)]">
            <div className="p-5 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0 shadow-sm relative z-10">
              <h4 className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
                <Link2 size={16} className="text-[var(--accent)]" />
                Vidrieras a vincular
                <span className="bg-[var(--accent)] text-[var(--accent-ink)] text-xs px-2 py-0.5 rounded-full ml-auto">{selectedPubs.length}</span>
              </h4>
              <p className="text-xs text-[var(--text-muted)] mt-1">Este artículo se descontará por cada venta de estas publicaciones.</p>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 relative max-h-[45vh] md:max-h-none">
              {existingLinks.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Ya vinculadas</p>
                  <div className="space-y-2">
                    {existingLinks.map((l) => (
                      <div key={l.id} className="p-2.5 bg-[var(--surface)] border border-[var(--border)] rounded-lg flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-[var(--text)] truncate">{l.titulo}</p>
                          <p className="text-[11px] text-[var(--text-muted)] font-mono">{l.external_item_id}</p>
                        </div>
                        <button onClick={() => desvincular(l.id)} className="shrink-0 p-1.5 text-[var(--text-faint)] hover:text-[var(--err)] hover:bg-[var(--err)]/10 rounded-md transition-colors" title="Desvincular">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedPubs.length === 0 && existingLinks.length === 0 ? (
                <div className="text-center py-12 text-[var(--text-faint)] border-2 border-dashed border-[var(--border)] rounded-xl bg-[var(--surface)]/50">
                  <Package size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm px-4">No hay vidrieras seleccionadas.<br />Añade publicaciones desde la izquierda.</p>
                </div>
              ) : selectedPubs.length > 0 ? (
                <>
                  {existingLinks.length > 0 && (
                    <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Nuevas a vincular</p>
                  )}
                  {selectedPubs.map((s) => (
                    <div key={s.id} className="p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm hover:border-[var(--accent)]/50 transition-colors relative group">
                      <button onClick={() => removePub(s.id)} className="absolute top-2 right-2 p-1.5 text-[var(--text-faint)] hover:text-[var(--err)] hover:bg-[var(--err)]/10 rounded-md transition-colors" title="Quitar">
                        <X size={14} />
                      </button>
                      <p className="text-sm font-semibold text-[var(--text)] pr-6 leading-tight mb-2">{s.titulo}</p>
                      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                        <span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded border border-[var(--border)]">{s.external_item_id}</span>
                        {s.brand && <span className="text-xs text-[var(--text-faint)]">Marca: {s.brand}</span>}
                        {(s.ean || s.gtin || s.upc) && <span className="text-xs font-mono text-[var(--text-faint)]">Cod: {s.ean || s.gtin || s.upc}</span>}
                        {s.precio_venta != null && <span className="text-xs text-[var(--text-faint)]">${s.precio_venta.toLocaleString('es-MX')}</span>}
                      </div>
                      <div className="flex items-center justify-between mt-auto pt-3 border-t border-[var(--border)]">
                        <span className="text-xs font-medium text-[var(--text-muted)]">Cantidad por venta</span>
                        <div className="flex items-center border border-[var(--border)] bg-[var(--surface-2)] rounded-lg overflow-hidden h-7">
                          <button onClick={() => changeQuantity(s.id, s.quantity - 1)} className="w-9 h-full flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] font-bold transition-colors">-</button>
                          <input type="number" value={s.quantity} onChange={(e) => changeQuantity(s.id, parseInt(e.target.value) || 1)} className="w-12 h-full text-center text-xs font-bold bg-transparent border-none appearance-none p-0 focus:ring-0 text-[var(--text)]" />
                          <button onClick={() => changeQuantity(s.id, s.quantity + 1)} className="w-9 h-full flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] font-bold transition-colors">+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)] bg-[var(--surface)] shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-20">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg hover:bg-[var(--surface-2)]/80 hover:text-[var(--text)] transition-colors">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={saving || selectedPubs.length === 0}
            className={`px-6 py-2.5 text-sm font-semibold rounded-lg hover:brightness-110 disabled:opacity-40 flex items-center gap-2 transition-all shadow-sm ${selectedPubs.length === 0 ? 'text-[var(--err)] bg-[var(--err)]/15 border border-[var(--err)]/30' : 'text-[var(--accent-ink)] bg-[var(--accent)]'}`}
          >
            {saving ? (<><RefreshCw size={16} className="animate-spin" />Guardando...</>) : (<><Save size={16} />Guardar vinculación ({selectedPubs.length})</>)}
          </button>
        </div>
      </div>
    </div>
  );
}
