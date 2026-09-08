"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, AlertCircle, Check, Pencil, Ban, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

type Vendedor = { id: string; nombre: string; email: string | null; telefono: string | null; activo: boolean };
type Rango = { id: string; nombre: string; porcentaje: number; activo: boolean };

export default function VendedoresPage() {
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [rangos, setRangos] = useState<Rango[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [vForm, setVForm] = useState({ nombre: '', email: '', telefono: '' });
  const [vEditId, setVEditId] = useState<string | null>(null);
  const [rForm, setRForm] = useState({ nombre: '', porcentaje: '' });
  const [rEditId, setREditId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [v, r] = await Promise.all([
        fetch('/api/ventas/vendedores').then((x) => x.json()),
        fetch('/api/ventas/rangos').then((x) => x.json()),
      ]);
      setVendedores(v.vendedores || []);
      setRangos(r.rangos || []);
    } catch (e: any) {
      setError(e.message || 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const avisar = (_msg?: string | null) => { setError(null); setSuccess(true); setTimeout(() => setSuccess(false), 3000); };

  // ── Vendedores ────────────────────────────────────────────────
  async function guardarVendedor() {
    if (!vForm.nombre.trim()) { setError('El nombre es obligatorio'); return; }
    setError(null);
    const res = await fetch('/api/ventas/vendedores', {
      method: vEditId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(vEditId ? { id: vEditId, ...vForm, nombre: vForm.nombre.trim() } : { ...vForm, nombre: vForm.nombre.trim() }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Error'); return; }
    avisar('Vendedor guardado');
    setVForm({ nombre: '', email: '', telefono: '' }); setVEditId(null);
    cargar();
  }

  function editarVendedor(v: Vendedor) {
    setVEditId(v.id);
    setVForm({ nombre: v.nombre, email: v.email || '', telefono: v.telefono || '' });
  }

  async function toggleVendedor(v: Vendedor) {
    const res = await fetch('/api/ventas/vendedores', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v.id, activo: !v.activo }) });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Error'); return; }
    cargar();
  }

  // ── Rangos ────────────────────────────────────────────────────
  async function guardarRango() {
    if (!rForm.nombre.trim()) { setError('El nombre es obligatorio'); return; }
    const pct = Number(rForm.porcentaje);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) { setError('Porcentaje inválido (0-100)'); return; }
    setError(null);
    const res = await fetch('/api/ventas/rangos', {
      method: rEditId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rEditId ? { id: rEditId, nombre: rForm.nombre.trim(), porcentaje: pct } : { nombre: rForm.nombre.trim(), porcentaje: pct }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Error'); return; }
    avisar('Rango guardado');
    setRForm({ nombre: '', porcentaje: '' }); setREditId(null);
    cargar();
  }

  function editarRango(r: Rango) {
    setREditId(r.id);
    setRForm({ nombre: r.nombre, porcentaje: String(r.porcentaje) });
  }

  async function toggleRango(r: Rango) {
    const res = await fetch('/api/ventas/rangos', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, activo: !r.activo }) });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Error'); return; }
    cargar();
  }

  const inputBase = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)]';

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
        <ArrowLeft className="w-4 h-4" /> Inicio
      </Link>
      <h1 className="text-lg font-bold text-[var(--text)]">Vendedores y Rangos de descuento</h1>

      {error && <div className="text-sm text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded p-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}
      {success && <div className="text-sm text-[var(--ok)] bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded p-2 flex items-center gap-2"><Check className="w-4 h-4" />Guardado</div>}

      {/* Vendedores */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] p-5 space-y-3">
        <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Vendedores</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Nombre *</label><input className={inputBase} value={vForm.nombre} onChange={(e) => setVForm({ ...vForm, nombre: e.target.value })} /></div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Email</label><input className={inputBase} value={vForm.email} onChange={(e) => setVForm({ ...vForm, email: e.target.value })} /></div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Teléfono</label><input className={inputBase} value={vForm.telefono} onChange={(e) => setVForm({ ...vForm, telefono: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2">
          {vEditId && <button onClick={() => { setVEditId(null); setVForm({ nombre: '', email: '', telefono: '' }); }} className="px-3 py-2 text-sm text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)]">Cancelar</button>}
          <button onClick={guardarVendedor} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110"><Save className="w-4 h-4" /> {vEditId ? 'Guardar' : 'Agregar'}</button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
            <th className="py-2">Nombre</th><th className="py-2">Email</th><th className="py-2">Tel.</th><th className="py-2 text-right"></th>
          </tr></thead>
          <tbody>
            {vendedores.map((v) => (
              <tr key={v.id} className={cn('border-b border-[var(--border)] last:border-0', !v.activo && 'opacity-50')}>
                <td className="py-2 text-[var(--text)]">{v.nombre}</td>
                <td className="py-2 text-[var(--text-muted)]">{v.email || '—'}</td>
                <td className="py-2 text-[var(--text-muted)]">{v.telefono || '—'}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button onClick={() => editarVendedor(v)} className="text-[var(--text-faint)] hover:text-[var(--accent)] mr-2" title="Editar"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => toggleVendedor(v)} className={v.activo ? 'text-[var(--text-faint)] hover:text-[var(--err)]' : 'text-[var(--ok)]'} title={v.activo ? 'Desactivar' : 'Reactivar'}>{v.activo ? <Ban className="w-4 h-4" /> : <CircleCheck className="w-4 h-4" />}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rangos */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] p-5 space-y-3">
        <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Rangos de descuento</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md">
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Nombre *</label><input className={inputBase} value={rForm.nombre} onChange={(e) => setRForm({ ...rForm, nombre: e.target.value })} placeholder="Ej. 18%" /></div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Porcentaje *</label><input className={inputBase} type="number" min={0} max={100} value={rForm.porcentaje} onChange={(e) => setRForm({ ...rForm, porcentaje: e.target.value })} /></div>
        </div>
        <div className="flex justify-end gap-2">
          {rEditId && <button onClick={() => { setREditId(null); setRForm({ nombre: '', porcentaje: '' }); }} className="px-3 py-2 text-sm text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)]">Cancelar</button>}
          <button onClick={guardarRango} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110"><Save className="w-4 h-4" /> {rEditId ? 'Guardar' : 'Agregar'}</button>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
            <th className="py-2">Nombre</th><th className="py-2 text-right">Porcentaje</th><th className="py-2 text-right"></th>
          </tr></thead>
          <tbody>
            {rangos.map((r) => (
              <tr key={r.id} className={cn('border-b border-[var(--border)] last:border-0', !r.activo && 'opacity-50')}>
                <td className="py-2 text-[var(--text)]">{r.nombre}</td>
                <td className="py-2 text-right text-[var(--text)]">{r.porcentaje}%</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button onClick={() => editarRango(r)} className="text-[var(--text-faint)] hover:text-[var(--accent)] mr-2" title="Editar"><Pencil className="w-4 h-4" /></button>
                  <button onClick={() => toggleRango(r)} className={r.activo ? 'text-[var(--text-faint)] hover:text-[var(--err)]' : 'text-[var(--ok)]'} title={r.activo ? 'Desactivar' : 'Reactivar'}>{r.activo ? <Ban className="w-4 h-4" /> : <CircleCheck className="w-4 h-4" />}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
