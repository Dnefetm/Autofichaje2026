'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const ESTADOS = [
  { value: 'danado', label: 'Dañado (saca de venta → caja de dañados)' },
  { value: 'devolucion', label: 'Devolución (saca de venta → caja de devoluciones)' },
  { value: 'desecho', label: 'Desecho (cierra stock dañado)' },
  { value: 'devolver', label: 'Devolver a proveedor (cierra stock en devolución)' },
];

export default function TraspasoPage() {
  const [articuloId, setArticuloId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [estado, setEstado] = useState('danado');
  const [ubicacion, setUbicacion] = useState('');
  const [loading, setLoading] = useState(false);

  const requiereUbicacion = estado === 'danado' || estado === 'devolucion';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/inventario/traspaso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        articulo_id: articuloId.trim(),
        cantidad: Number(cantidad),
        estado,
        ubicacion: ubicacion.trim(),
      }),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j?.error || 'Error al hacer el traspaso');
      return;
    }
    toast.success('Traspaso registrado');
    setArticuloId('');
    setCantidad('');
    setUbicacion('');
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-lg font-semibold text-[var(--text)]">Traspaso de stock</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Mueve stock de "disponible" a dañado/devolución, o ciérralo (desecho / devolver).
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius)] p-4 space-y-3"
      >
        <div className="space-y-1">
          <label className="text-xs text-[var(--text-muted)]">Artículo (articulo_id)</label>
          <input
            value={articuloId}
            onChange={(e) => setArticuloId(e.target.value)}
            required
            placeholder="ej. NAP-60771641"
            className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">Cantidad</label>
            <input
              type="number"
              min={1}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              required
              className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">Acción</label>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
            >
              {ESTADOS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {requiereUbicacion && (
          <div className="space-y-1">
            <label className="text-xs text-[var(--text-muted)]">Caja destino</label>
            <input
              value={ubicacion}
              onChange={(e) => setUbicacion(e.target.value)}
              placeholder="ej. CAJA DAÑADOS"
              className="w-full px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] outline-none focus:border-[var(--accent)]"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-ink)] font-medium disabled:opacity-60"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Guardar traspaso
        </button>
      </form>
    </div>
  );
}
