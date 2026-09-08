"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Plus, Loader2, AlertCircle, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

type Pedido = {
  id: string;
  fecha: string;
  estado: string;
  total: number;
  cliente: { nombre: string } | null;
  vendedor: { nombre: string } | null;
};

const ESTADOS: Record<string, { label: string; badge: string }> = {
  borrador:   { label: 'Borrador',   badge: 'bg-[var(--surface-2)] text-[var(--text-muted)]' },
  confirmado: { label: 'Confirmado', badge: 'bg-[var(--info)]/10 text-[var(--info)]' },
  surtido:    { label: 'Surtido',    badge: 'bg-[var(--warn)]/10 text-[var(--warn)]' },
  entregado:  { label: 'Entregado',  badge: 'bg-[var(--ok)]/10 text-[var(--ok)]' },
  cancelado:  { label: 'Cancelado',  badge: 'bg-[var(--err)]/10 text-[var(--err)]' },
};

export default function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/ventas/pedidos');
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Error');
      setPedidos(d.pedidos || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const fmt = (n: number) => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-[var(--text)]">Pedidos</h1>
          <p className="text-xs text-[var(--text-faint)]">Flujo: Confirmado → Surtido → Entregado</p>
        </div>
        <Link href="/ventas/pedidos/nuevo" className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110">
          <Plus className="w-4 h-4" /> Nuevo pedido
        </Link>
      </div>

      {error && <div className="text-sm text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded p-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}

      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-5 text-sm text-[var(--text-muted)]">Cargando…</div>
        ) : pedidos.length === 0 ? (
          <div className="p-5 text-sm text-[var(--text-faint)] italic">Sin pedidos todavía. Crea el primero con &quot;Nuevo pedido&quot;.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
              <th className="px-4 py-2">Fecha</th><th className="px-4 py-2">Cliente</th><th className="px-4 py-2">Vendedor</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2">Estado</th><th className="px-4 py-2 text-right"></th>
            </tr></thead>
            <tbody>
              {pedidos.map((p) => {
                const st = ESTADOS[p.estado] || { label: p.estado, badge: 'bg-[var(--surface-2)] text-[var(--text-muted)]' };
                return (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]/50">
                    <td className="px-4 py-2 text-[var(--text-muted)]">{new Date(p.fecha).toLocaleDateString('es-MX')}</td>
                    <td className="px-4 py-2 text-[var(--text)]">{p.cliente?.nombre || '—'}</td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">{p.vendedor?.nombre || '—'}</td>
                    <td className="px-4 py-2 text-right font-semibold text-[var(--text)]">{fmt(p.total)}</td>
                    <td className="px-4 py-2"><span className={cn('px-2 py-0.5 rounded-full text-[11px] font-bold', st.badge)}>{st.label}</span></td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/ventas/pedidos/${p.id}`} className="inline-flex items-center gap-1 px-3 py-1 text-xs font-bold text-[var(--accent)] border border-[var(--accent)]/30 rounded-[var(--radius-sm)] hover:bg-[var(--accent)]/10">
                        <Eye className="w-3.5 h-3.5" /> Ver
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
