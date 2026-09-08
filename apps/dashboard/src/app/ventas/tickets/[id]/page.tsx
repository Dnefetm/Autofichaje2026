"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Printer, PackageCheck, Truck, Loader2 } from 'lucide-react';

type Ticket = {
  pedido_id: string;
  folio: string;
  fecha: string;
  total: number;
  cliente: { nombre: string; direccion: string | null; telefono: string | null; rfc: string | null; razon_social: string | null } | null;
  vendedor: { nombre: string } | null;
  pedido: { descuento_aplicado: number; estado: string } | null;
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
  descuento: number;
  subtotal: number;
  articulo: { nombre: string } | null;
};

// Nombre a imprimir: catálogo → nombre del artículo; proveedor → UH | Urrea | 9713 | Descripción
function nombreItem(it: Item): string {
  if (it.proveedor_corto || it.marca || it.modelo) {
    return [it.proveedor_corto, it.marca, it.modelo, it.descripcion].filter(Boolean).join(' | ');
  }
  return it.articulo?.nombre || it.descripcion || it.articulo_id || '—';
}

export default function TicketPage() {
  const { id } = useParams();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [accion, setAccion] = useState<'surtir' | 'entregar' | null>(null);
  const [accionError, setAccionError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/ventas/tickets/' + id)
      .then((r) => r.json())
      .then((d) => {
        setTicket(d.ticket);
        setItems(d.items || []);
      })
      .finally(() => setLoading(false));
  }, [id, refresh]);

  async function ejecutar(tipo: 'surtir' | 'entregar') {
    if (!ticket) return;
    setAccion(tipo); setAccionError(null);
    const r = await fetch(`/api/ventas/pedidos/${ticket.pedido_id}/${tipo}`, { method: 'POST' });
    const d = await r.json();
    setAccion(null);
    if (!r.ok) { setAccionError(d.error || 'Error'); return; }
    setRefresh((x) => x + 1);
  }

  const fmt = (n: number) => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (loading) return <div className="max-w-xl mx-auto p-8 text-sm text-[var(--text-muted)]">Cargando ticket…</div>;
  if (!ticket) return <div className="max-w-xl mx-auto p-8 text-sm text-[var(--err)]">Ticket no encontrado.</div>;

  const estado = ticket.pedido?.estado;

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/ventas/pedidos" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          <ArrowLeft className="w-4 h-4" /> Pedidos
        </Link>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)]">
          <Printer className="w-4 h-4" /> Imprimir
        </button>
      </div>

      {/* Ticket */}
      <div className="bg-white text-black rounded p-6 space-y-4 shadow print:shadow-none">
        <div className="text-center border-b border-black pb-3">
          <h1 className="text-lg font-bold">Ticket de venta</h1>
          <p className="text-sm">Folio: {ticket.folio}</p>
          <p className="text-sm">{new Date(ticket.fecha).toLocaleString('es-MX')}</p>
        </div>

        <div className="space-y-1 text-sm">
          <p><strong>Cliente:</strong> {ticket.cliente?.nombre || '—'}</p>
          {ticket.cliente?.razon_social && <p><strong>Razón social:</strong> {ticket.cliente.razon_social}</p>}
          {ticket.cliente?.rfc && <p><strong>RFC:</strong> {ticket.cliente.rfc}</p>}
          {ticket.cliente?.direccion && <p><strong>Dirección:</strong> {ticket.cliente.direccion}</p>}
          {ticket.cliente?.telefono && <p><strong>Tel:</strong> {ticket.cliente.telefono}</p>}
          {ticket.vendedor && <p><strong>Vendedor:</strong> {ticket.vendedor.nombre}</p>}
        </div>

        <table className="w-full text-sm border-t border-black pt-2">
          <thead><tr className="text-left">
            <th className="py-1">Artículo</th><th className="py-1 text-right">Cant.</th><th className="py-1 text-right">P. menudeo</th><th className="py-1 text-right">Subtotal</th>
          </tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-t border-gray-300">
                <td className="py-1">
                  <div>{nombreItem(it)}</div>
                  <div className="text-[10px] uppercase tracking-wide">{it.fuente_pendiente ? 'Por surtir' : 'En stock'}</div>
                </td>
                <td className="py-1 text-right">{it.cantidad}</td>
                <td className="py-1 text-right">{it.precio_menudeo > 0 ? fmt(it.precio_menudeo) : 'Precio pendiente'}</td>
                <td className="py-1 text-right">{it.precio_menudeo > 0 ? fmt(it.subtotal) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="text-right text-sm border-t border-black pt-2 space-y-1">
          {ticket.pedido && ticket.pedido.descuento_aplicado > 0 && (
            <p>Descuento aplicado: {ticket.pedido.descuento_aplicado}%</p>
          )}
          <p className="text-lg font-bold">Total: {fmt(ticket.total)}</p>
        </div>
      </div>

      {/* Acciones de surtido/entrega (no se imprimen) */}
      <div className="flex items-center gap-2 print:hidden">
        {accionError && <span className="text-xs text-[var(--err)]">{accionError}</span>}
        {estado === 'confirmado' && (
          <button onClick={() => ejecutar('surtir')} disabled={!!accion} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50">
            {accion === 'surtir' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />} Surtir (egreso)
          </button>
        )}
        {estado === 'surtido' && (
          <button onClick={() => ejecutar('entregar')} disabled={!!accion} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50">
            {accion === 'entregar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Marcar entregado
          </button>
        )}
        {estado === 'entregado' && <span className="text-xs font-bold text-[var(--ok)]">Entregado</span>}
      </div>
    </div>
  );
}
