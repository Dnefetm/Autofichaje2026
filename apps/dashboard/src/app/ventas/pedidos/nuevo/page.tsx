"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Trash2, Loader2, AlertCircle, Check, ReceiptText } from 'lucide-react';
import { cn } from '@/lib/utils';

type Cliente = { id: string; nombre: string; vendedor_id: string | null; rango: { nombre: string; porcentaje: number } | null };
type Vendedor = { id: string; nombre: string };
type Item = {
  tipo: 'catalogo' | 'proveedor';
  articulo_id: string | null;
  nombre: string | null;
  marca: string | null;
  modelo: string | null;
  descripcion: string | null;
  proveedor_corto: string | null;
  proveedor: string | null;
  precio_menudeo: number;
  disponible: number;
};
type Linea = Item & { cantidad: number; subtotal: number };

// Clave única de línea: catálogo → articulo_id; proveedor → proveedor+marca+modelo+descripcion
function claveLinea(it: Item): string {
  return it.tipo === 'proveedor'
    ? ['p', it.proveedor_corto || it.proveedor, it.marca, it.modelo, it.descripcion].join('|')
    : 'c|' + it.articulo_id;
}

// Nombre a mostrar: catálogo → nombre; proveedor → UH | Urrea | 9713 | Descripción
function nombreLinea(it: Item | Linea): string {
  if (it.tipo === 'proveedor') {
    return [it.proveedor_corto || it.proveedor, it.marca, it.modelo, it.descripcion].filter(Boolean).join(' | ');
  }
  return it.nombre || it.articulo_id || '—';
}

// Leyenda de stock: En stock (físico disponible) / Por surtir
function leyendaLinea(it: Item): { texto: string; clase: string } {
  if (it.tipo === 'proveedor') return { texto: 'Por surtir', clase: 'text-[var(--warn)]' };
  const d = it.disponible ?? 0;
  return d > 0
    ? { texto: `En stock · ${d} disp.`, clase: 'text-[var(--ok)]' }
    : { texto: 'Por surtir', clase: 'text-[var(--warn)]' };
}

export default function NuevoPedidoPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [vendedorId, setVendedorId] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<Item[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/ventas/clientes').then((r) => r.json()).then((d) => setClientes(d.clientes || []));
    fetch('/api/ventas/vendedores').then((r) => r.json()).then((d) => setVendedores((d.vendedores || []).filter((v: any) => v.activo)));
  }, []);

  const cliente = useMemo(() => clientes.find((c) => c.id === clienteId), [clientes, clienteId]);
  const porcentaje = cliente?.rango?.porcentaje || 0;

  function cambiarCliente(id: string) {
    setClienteId(id);
    const c = clientes.find((x) => x.id === id);
    if (c?.vendedor_id) setVendedorId(c.vendedor_id);
  }

  const buscar = useCallback(async () => {
    if (!busqueda.trim()) { setResultados([]); return; }
    const r = await fetch('/api/ventas/menudeo?q=' + encodeURIComponent(busqueda));
    const d = await r.json();
    setResultados(d.items || []);
  }, [busqueda]);

  useEffect(() => { const t = setTimeout(buscar, 300); return () => clearTimeout(t); }, [buscar]);

  function agregar(it: Item) {
    const k = claveLinea(it);
    setLineas((prev) => {
      const idx = prev.findIndex((l) => claveLinea(l) === k);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + 1 };
        return next;
      }
      return [...prev, { ...it, cantidad: 1, subtotal: it.precio_menudeo }];
    });
    setResultados([]);
    setBusqueda('');
  }

  function quitar(k: string) {
    setLineas((prev) => prev.filter((l) => claveLinea(l) !== k));
  }

  const total = useMemo(() => {
    const bruto = lineas.reduce((s, l) => s + l.precio_menudeo * l.cantidad, 0);
    return bruto * (1 - porcentaje / 100);
  }, [lineas, porcentaje]);

  const hayPendientes = lineas.some((l) => l.precio_menudeo <= 0);

  async function guardar() {
    if (!clienteId) { setError('Selecciona un cliente'); return; }
    if (lineas.length === 0) { setError('Agrega al menos un artículo'); return; }
    setSaving(true); setError(null); setSuccess(false);
    try {
      const res = await fetch('/api/ventas/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: clienteId,
          vendedor_id: vendedorId || null,
          items: lineas.map((l) => ({
            tipo: l.tipo,
            articulo_id: l.articulo_id,
            nombre: l.nombre,
            proveedor: l.proveedor,
            proveedor_corto: l.proveedor_corto,
            marca: l.marca,
            modelo: l.modelo,
            descripcion: l.descripcion,
            cantidad: l.cantidad,
            precio_menudeo: l.precio_menudeo,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar');

      // Generar ticket (aquí se reserva el stock y se marca confirmado)
      const tRes = await fetch('/api/ventas/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedido_id: data.pedido_id }),
      });
      const tData = await tRes.json();
      if (tRes.ok && tData.ticket_id) {
        router.push('/ventas/tickets/' + tData.ticket_id);
      } else {
        setSuccess(true);
        setLineas([]);
        setClienteId('');
        setVendedorId('');
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (e: any) {
      setError(e.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  const inputBase = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)]';
  const fmt = (n: number) => '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPrecio = (n: number) => (n > 0 ? fmt(n) : 'Precio pendiente');

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <Link href="/ventas/pedidos" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
        <ArrowLeft className="w-4 h-4" /> Pedidos
      </Link>
      <h1 className="text-lg font-bold text-[var(--text)]">Nuevo pedido</h1>

      {error && <div className="text-sm text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded p-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}
      {success && <div className="text-sm text-[var(--ok)] bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded p-2 flex items-center gap-2"><Check className="w-4 h-4" />Pedido guardado</div>}

      {/* Cliente y vendedor */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] p-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Cliente</label>
            <select className={inputBase} value={clienteId} onChange={(e) => cambiarCliente(e.target.value)}>
              <option value="">— Seleccionar cliente —</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Vendedor</label>
            <select className={inputBase} value={vendedorId} onChange={(e) => setVendedorId(e.target.value)}>
              <option value="">— Sin asignar —</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>
        </div>
        {cliente && <p className="text-xs text-[var(--text-muted)]">Descuento: <span className="font-bold text-[var(--text)]">{porcentaje}%</span></p>}
      </div>

      {/* Buscar artículo */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] p-5 space-y-3">
        <label className="block text-[11px] font-semibold text-[var(--text-muted)]">Buscar artículo (catálogo o lista de proveedor)</label>
        <input className={inputBase} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej. pinza, urrea, 9713…" />
        {resultados.length > 0 && (
          <div className="border border-[var(--border)] rounded-[var(--radius-sm)] overflow-hidden">
            {resultados.map((it) => (
              <button key={claveLinea(it)} onClick={() => agregar(it)} className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-[var(--surface-2)] border-b border-[var(--border)] last:border-0">
                <span className="text-sm text-[var(--text)]">
                  {nombreLinea(it)}{' '}
                  {it.tipo === 'catalogo' && it.articulo_id && <span className="text-[var(--text-faint)]">({it.articulo_id})</span>}
                  {it.tipo === 'proveedor' && <span className="ml-1 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">proveedor</span>}
                  <span className={cn('ml-2 text-[11px] font-semibold', leyendaLinea(it).clase)}>{leyendaLinea(it).texto}</span>
                </span>
                <span className={it.precio_menudeo > 0 ? 'text-sm font-semibold text-[var(--text)]' : 'text-sm italic text-[var(--text-faint)]'}>
                  {fmtPrecio(it.precio_menudeo)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Líneas */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Artículos del pedido</h2>
        </div>
        {lineas.length === 0 ? (
          <div className="p-5 text-sm text-[var(--text-faint)] italic">Sin artículos.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
              <th className="px-4 py-2">Artículo</th><th className="px-4 py-2 text-right">P. menudeo</th><th className="px-4 py-2 text-right">Cant.</th><th className="px-4 py-2 text-right">Subtotal</th><th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={claveLinea(l)} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-2 text-[var(--text)]">
                    {nombreLinea(l)}{' '}
                    {l.tipo === 'catalogo' && l.articulo_id && <span className="text-[var(--text-faint)]">({l.articulo_id})</span>}
                    <div className={cn('text-[11px] font-semibold', leyendaLinea(l).clase)}>{leyendaLinea(l).texto}</div>
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--text-muted)]">
                    {l.precio_menudeo > 0 ? fmt(l.precio_menudeo) : <span className="italic text-[var(--text-faint)]">Precio pendiente</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <input type="number" min={1} className="w-16 bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-right text-[var(--text)]" value={l.cantidad}
                      onChange={(e) => setLineas((prev) => prev.map((x) => claveLinea(x) === claveLinea(l) ? { ...x, cantidad: Number(e.target.value) || 1 } : x))} />
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-[var(--text)]">{fmt(l.precio_menudeo * l.cantidad * (1 - porcentaje / 100))}</td>
                  <td className="px-4 py-2 text-right"><button onClick={() => quitar(claveLinea(l))} className="text-[var(--text-faint)] hover:text-[var(--err)]"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Total + guardar */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] p-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-[var(--text-muted)]">Total con {porcentaje}% de descuento</p>
          <p className="text-xl font-bold text-[var(--text)]">{fmt(total)}</p>
          {hayPendientes && <p className="text-[11px] text-[var(--warn)]">Hay artículos con precio pendiente (no se incluyen en el total)</p>}
        </div>
        <button onClick={guardar} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ReceiptText className="w-4 h-4" />} Guardar y generar ticket
        </button>
      </div>
    </div>
  );
}
