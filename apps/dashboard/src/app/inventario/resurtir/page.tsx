'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

type Item = { articulo_id: string; nombre: string; stock: number; vendido: number };

export default function ResurtirPage() {
  const [dias, setDias] = useState(60);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/inventario/resurtir?dias=${dias}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Error al cargar');
      setItems(j.items ?? []);
    } catch (e: any) {
      setError(e?.message || 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [dias]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text)]">Resurtir</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Artículos con stock menor a lo vendido en los últimos {dias} días.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--text-muted)]">Ventana</label>
          <select
            value={dias}
            onChange={(e) => setDias(Number(e.target.value))}
            className="px-2 py-1.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-sm text-[var(--text)]"
          >
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--err)]">{error}</p>}

      <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
              <th className="px-3 py-2">Artículo</th>
              <th className="px-3 py-2 text-right">Stock</th>
              <th className="px-3 py-2 text-right">Vendido ({dias}d)</th>
              <th className="px-3 py-2 text-right">Falta</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-[var(--text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin inline" /> Cargando…
                </td>
              </tr>
            )}
            {!loading && items && items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-[var(--text-faint)]">
                  Nada por resurtir en esta ventana.
                </td>
              </tr>
            )}
            {!loading &&
              items?.map((it) => (
                <tr key={it.articulo_id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2">
                    <div className="text-[var(--text)]">{it.nombre}</div>
                    <div className="text-xs text-[var(--text-faint)]">{it.articulo_id}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--text)]">{it.stock}</td>
                  <td className="px-3 py-2 text-right text-[var(--text)]">{it.vendido}</td>
                  <td className="px-3 py-2 text-right font-medium text-[var(--warn)]">
                    {it.vendido - it.stock}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
