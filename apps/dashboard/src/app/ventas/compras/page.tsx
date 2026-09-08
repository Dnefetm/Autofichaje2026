"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, AlertCircle, Check } from 'lucide-react';

type Linea = {
  id: string;
  cantidad: number;
  cantidad_surtida: number;
  fuente_pendiente: string | null;
  proveedor: string | null;
  proveedor_corto: string | null;
  marca: string | null;
  modelo: string | null;
  descripcion: string | null;
  articulo_id: string | null;
  pedido: { id: string; fecha: string; cliente: { nombre: string } | null } | null;
};
type Proveedor = { nombre: string; codigo_corto: string | null };

export default function ComprasPage() {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [provs, setProvs] = useState<Proveedor[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [guardandoProv, setGuardandoProv] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [p, prov] = await Promise.all([
        fetch('/api/ventas/compras/pendientes').then((r) => r.json()),
        fetch('/api/precios/proveedores').then((r) => r.json()),
      ]);
      const arr: Linea[] = p.lineas || [];
      arr.sort((a, b) => new Date(b.pedido?.fecha || 0).getTime() - new Date(a.pedido?.fecha || 0).getTime());
      setLineas(arr);

      const provList: Proveedor[] = prov.proveedores || [];
      setProvs(provList);
      const d: Record<string, string> = {};
      for (const pr of provList) d[pr.nombre] = pr.codigo_corto || '';
      setDrafts(d);
    } catch (e: any) {
      setError(e.message || 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardarCodigo(nombre: string) {
    setGuardandoProv(nombre); setError(null); setSuccess(false);
    const res = await fetch('/api/precios/proveedores', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, codigo_corto: drafts[nombre] || '' }),
    });
    setGuardandoProv(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Error al guardar');
      return;
    }
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  }

  const nombre = (l: Linea) => [l.proveedor_corto || l.proveedor, l.marca, l.modelo, l.descripcion].filter(Boolean).join(' | ') || l.articulo_id || '—';
  const pendiente = (l: Linea) => Math.max(0, l.cantidad - (l.cantidad_surtida || 0));
  const inputBase = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)]';

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <Link href="/ventas/pedidos" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
        <ArrowLeft className="w-4 h-4" /> Pedidos
      </Link>
      <h1 className="text-lg font-bold text-[var(--text)]">Órdenes de compra (Por surtir)</h1>
      <p className="text-sm text-[var(--text-muted)]">Líneas que no alcanzó a cubrir el stock físico. Revísalas con el proveedor.</p>

      {error && <div className="text-sm text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded p-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}
      {success && <div className="text-sm text-[var(--ok)] bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded p-2 flex items-center gap-2"><Check className="w-4 h-4" />Código guardado</div>}

      {/* Por surtir */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Por surtir</h2>
        </div>
        {loading ? (
          <div className="p-5 text-sm text-[var(--text-muted)]">Cargando…</div>
        ) : lineas.length === 0 ? (
          <div className="p-5 text-sm text-[var(--text-faint)] italic">Sin líneas por surtir.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
              <th className="px-4 py-2">Artículo</th><th className="px-4 py-2">Cliente</th><th className="px-4 py-2 text-right">Por surtir</th><th className="px-4 py-2">Origen</th><th className="px-4 py-2">Pedido</th>
            </tr></thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 text-[var(--text)]">{nombre(l)}</td>
                  <td className="px-4 py-2 text-[var(--text)]">{l.pedido?.cliente?.nombre || '—'}</td>
                  <td className="px-4 py-2 text-right font-semibold text-[var(--warn)]">{pendiente(l)}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{l.fuente_pendiente === 'proveedor' ? 'Proveedor' : 'Orden de compra'}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{l.pedido ? new Date(l.pedido.fecha).toLocaleDateString('es-MX') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Códigos cortos de proveedor */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Códigos de proveedor</h2>
        </div>
        <p className="px-5 pt-3 text-xs text-[var(--text-muted)]">Abreviatura que se muestra en el ticket (ej. &quot;Urrea Herramientas&quot; → &quot;UH&quot;).</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
            <th className="px-4 py-2">Proveedor</th><th className="px-4 py-2">Código corto</th><th className="px-4 py-2 text-right"></th>
          </tr></thead>
          <tbody>
            {provs.map((pr) => (
              <tr key={pr.nombre} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-2 text-[var(--text)]">{pr.nombre}</td>
                <td className="px-4 py-2">
                  <input className={inputBase} value={drafts[pr.nombre] ?? ''} onChange={(e) => setDrafts({ ...drafts, [pr.nombre]: e.target.value })} placeholder="Ej. UH" />
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => guardarCodigo(pr.nombre)} disabled={guardandoProv === pr.nombre} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50">
                    {guardandoProv === pr.nombre ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
