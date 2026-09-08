"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Loader2, ReceiptText, PackageCheck, Truck, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type Pedido = {
  id: string;
  fecha: string;
  estado: string;
  total: number;
  descuento_aplicado: number;
  cliente: { nombre: string; telefono: string | null } | null;
  vendedor: { nombre: string } | null;
  ticket: { id: string }[] | null;
};
type Item = {
  id: string;
  articulo_id: string | null;
  proveedor_corto: string | null;
  marca: string | null;
  modelo: string | null;
  descripcion: string | null;
  cantidad: number;
  cantidad_surtida: number;
  fuente_pendiente: string | null;
  precio_menudeo: number;
  subtotal: number;
};

const ESTADO: Record<string, { label: string; badge: string; hint: string }> = {
  borrador:   { label: 'Borrador',   badge: 'bg-[var(--surface-2)] text-[var(--text-muted)]', hint: 'Pendiente de confirmar.' },
  confirmado: { label: 'Confirmado', badge: 'bg-[var(--info)]/10 text-[var(--info)]',             hint: 'Stock reservado. Siguiente paso: surtir en bodega.' },
  surtido:    { label: 'Surtido',    badge: 'bg-[var(--warn)]/10 text-[var(--warn)]',             hint: 'Ya salió de bodega. Siguiente paso: entregar al cliente.' },
  entregado:  { label: 'Entregado',  badge: 'bg-[var(--ok)]/10 text-[var(--ok)]',                 hint: 'Pedido completo.' },
  cancelado:  { label: 'Cancelado',  badge: 'bg-[var(--err)]/10 text-[var(--err)]',               hint: 'Pedido cancelado.' },
};

function nombreItem(it: Item): string {
  if (it.proveedor_corto || it.marca || it.modelo) {
    return [it.proveedor_corto, it.marca, it.modelo, it.descripcion].filter(Boolean).join(' | ');
  }
  return it.descripcion || it.articulo_id || '—';
}

export default function PedidoDetallePage() {
  const { id } = useParams();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [reservado, setReservado] = useState(0);
  const [loading, setLoading] = useState(true);
  const [accion, setAccion] = useState<'surtir' | 'entregar' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    fetch('/api/ventas/pedidos/' + id)
      .then((r) => r.json())
      .then((d) => { setPedido(d.pedido); setItems(d.items || []); setReservado(d.reservado || 0); })
      .finally(() => setLoading(false));
  }, [id, refresh]);

  async function ejecutar(tipo: 'surtir' | 'entregar') {
    if (!pedido) return;
    setAccion(tipo); setError(null);
    const r = await fetch(`/api/ventas/pedidos/${pedido.id}/${tipo}`, { method: 'POST' });
    const d = await r.json();
    setAccion(null);
    if (!r.ok) { setError(d.error || 'Error'); return; }
    setRefresh((x) => x + 1);
  }

  const fmt = (n: number) => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) return <div className="max-w-3xl mx-auto p-8 text-sm text-[var(--text-muted)]">Cargando pedido…</div>;
  if (!pedido) return <div className="max-w-3xl mx-auto p-8 text-sm text-[var(--err)]">Pedido no encontrado.</div>;

  const st = ESTADO[pedido.estado] || ESTADO.borrador;
  const ticketId = Array.isArray(pedido.ticket) && pedido.ticket.length ? pedido.ticket[0].id : null;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <Link href="/ventas/pedidos" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
        <ArrowLeft className="w-4 h-4" /> Pedidos
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-[var(--text)]">Pedido</h1>
          <p className="text-sm text-[var(--text-muted)]">{new Date(pedido.fecha).toLocaleString('es-MX')}</p>
        </div>
        <span className={cn('px-3 py-1 rounded-full text-xs font-bold', st.badge)}>{st.label}</span>
      </div>

      {/* Siguiente paso */}
      <div className="text-sm text-[var(--text)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] p-3">
        <span className="font-semibold">{st.label}:</span> <span className="text-[var(--text-muted)]">{st.hint}</span>
      </div>

      {error && <div className="text-sm text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded p-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}

      {/* Datos */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div><span className="text-[var(--text-faint)] text-xs">Cliente</span><p className="font-semibold text-[var(--text)]">{pedido.cliente?.nombre || '—'}</p></div>
        <div><span className="text-[var(--text-faint)] text-xs">Vendedor</span><p className="font-semibold text-[var(--text)]">{pedido.vendedor?.nombre || '—'}</p></div>
        <div><span className="text-[var(--text-faint)] text-xs">Descuento</span><p className="font-semibold text-[var(--text)]">{pedido.descuento_aplicado}%</p></div>
        <div><span className="text-[var(--text-faint)] text-xs">Total</span><p className="font-semibold text-[var(--text)]">{fmt(pedido.total)}</p></div>
        <div className="sm:col-span-2"><span className="text-[var(--text-faint)] text-xs">Stock reservado</span><p className="font-semibold text-[var(--info)]">{reservado} pieza(s)</p></div>
      </div>

      {/* Líneas */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Artículos</h2>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
            <th className="px-4 py-2">Artículo</th><th className="px-4 py-2">Estado</th><th className="px-4 py-2 text-right">Cant.</th><th className="px-4 py-2 text-right">Surtido</th><th className="px-4 py-2 text-right">P. menudeo</th><th className="px-4 py-2 text-right">Subtotal</th>
          </tr></thead>
          <tbody>
            {items.map((it) => {
              const esPendiente = it.fuente_pendiente != null;
              const sinPrecio = it.precio_menudeo <= 0;
              return (
                <tr key={it.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 text-[var(--text)]">{nombreItem(it)}</td>
                  <td className="px-4 py-2">
                    <span className={cn('text-[11px] font-semibold', esPendiente ? 'text-[var(--warn)]' : 'text-[var(--ok)]')}>
                      {esPendiente ? 'Por surtir' : 'En stock'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--text)]">{it.cantidad}</td>
                  <td className="px-4 py-2 text-right text-[var(--text-muted)]">{it.cantidad_surtida}/{it.cantidad}</td>
                  <td className="px-4 py-2 text-right text-[var(--text-muted)]">{sinPrecio ? <span className="italic text-[var(--text-faint)]">Precio pendiente</span> : fmt(it.precio_menudeo)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-[var(--text)]">{sinPrecio ? '—' : fmt(it.subtotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Acciones */}
      <div className="flex flex-wrap items-center gap-2">
        {ticketId && (
          <Link href={`/ventas/tickets/${ticketId}`} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--text)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)]">
            <ReceiptText className="w-4 h-4" /> Ver / imprimir ticket
          </Link>
        )}
        {pedido.estado === 'confirmado' && (
          <button onClick={() => ejecutar('surtir')} disabled={!!accion} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50">
            {accion === 'surtir' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />} Surtir (egreso de bodega)
          </button>
        )}
        {pedido.estado === 'surtido' && (
          <button onClick={() => ejecutar('entregar')} disabled={!!accion} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50">
            {accion === 'entregar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Marcar entregado
          </button>
        )}
      </div>
    </div>
  );
}
