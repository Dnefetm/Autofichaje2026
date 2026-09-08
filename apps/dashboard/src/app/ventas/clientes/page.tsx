"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Save, Loader2, AlertCircle, Check, Pencil, Ban, CircleCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

type Rango = { id: string; nombre: string; porcentaje: number; activo: boolean };
type Vendedor = { id: string; nombre: string; activo: boolean };
type Cliente = {
  id: string;
  nombre: string;
  contacto: string | null;
  telefono: string | null;
  direccion: string | null;
  email: string | null;
  rfc: string | null;
  razon_social: string | null;
  vendedor_id: string | null;
  rango_descuento_id: string | null;
  activo: boolean;
  rango: { nombre: string; porcentaje: number } | null;
  vendedor: { nombre: string } | null;
};

const formVacio = { nombre: '', contacto: '', telefono: '', direccion: '', email: '', rfc: '', razon_social: '', vendedor_id: '', rango_descuento_id: '' };

export default function ClientesPage() {
  const [rangos, setRangos] = useState<Rango[]>([]);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [form, setForm] = useState(formVacio);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [r, v, c] = await Promise.all([
        fetch('/api/ventas/rangos').then((x) => x.json()),
        fetch('/api/ventas/vendedores').then((x) => x.json()),
        fetch('/api/ventas/clientes?todos=1').then((x) => x.json()),
      ]);
      setRangos(r.rangos || []);
      setVendedores(v.vendedores || []);
      setClientes(c.clientes || []);
    } catch (e: any) {
      setError(e.message || 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar() {
    if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return; }
    setSaving(true); setError(null); setSuccess(false);
    try {
      const body = {
        ...form,
        nombre: form.nombre.trim(),
        vendedor_id: form.vendedor_id || null,
        rango_descuento_id: form.rango_descuento_id || null,
      };
      const res = await fetch('/api/ventas/clientes', {
        method: editandoId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editandoId ? { ...body, id: editandoId } : body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al guardar');
      setSuccess(true);
      setForm(formVacio);
      setEditandoId(null);
      cargar();
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  function editar(c: Cliente) {
    setEditandoId(c.id);
    setForm({
      nombre: c.nombre,
      contacto: c.contacto || '',
      telefono: c.telefono || '',
      direccion: c.direccion || '',
      email: c.email || '',
      rfc: c.rfc || '',
      razon_social: c.razon_social || '',
      vendedor_id: c.vendedor_id || '',
      rango_descuento_id: c.rango_descuento_id || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setForm(formVacio);
  }

  async function toggleActivo(c: Cliente) {
    setError(null);
    const res = await fetch('/api/ventas/clientes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.id, activo: !c.activo }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || 'Error'); return; }
    cargar();
  }

  const inputBase = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)]';
  const rangosActivos = rangos.filter((r) => r.activo);
  const vendedoresActivos = vendedores.filter((v) => v.activo);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
        <ArrowLeft className="w-4 h-4" /> Inicio
      </Link>
      <h1 className="text-lg font-bold text-[var(--text)]">Clientes (Subdistribuidores)</h1>

      {/* Formulario */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] p-5 space-y-3">
        <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">{editandoId ? 'Editar cliente' : 'Registrar cliente'}</h2>
        {error && <div className="text-sm text-[var(--err)] bg-[var(--err)]/10 border border-[var(--err)]/30 rounded p-2 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</div>}
        {success && <div className="text-sm text-[var(--ok)] bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded p-2 flex items-center gap-2"><Check className="w-4 h-4" />Cliente guardado</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Nombre *</label><input className={inputBase} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Contacto</label><input className={inputBase} value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} /></div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Teléfono</label><input className={inputBase} value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Email</label><input className={inputBase} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="sm:col-span-2"><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Dirección</label><input className={inputBase} value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} /></div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">RFC (opcional)</label><input className={inputBase} value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value })} /></div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Razón social (opcional)</label><input className={inputBase} value={form.razon_social} onChange={(e) => setForm({ ...form, razon_social: e.target.value })} /></div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Vendedor</label>
            <select className={inputBase} value={form.vendedor_id} onChange={(e) => setForm({ ...form, vendedor_id: e.target.value })}>
              <option value="">— Sin asignar —</option>
              {vendedoresActivos.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>
          <div><label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">Rango de descuento</label>
            <select className={inputBase} value={form.rango_descuento_id} onChange={(e) => setForm({ ...form, rango_descuento_id: e.target.value })}>
              <option value="">— Sin asignar —</option>
              {rangosActivos.map((r) => <option key={r.id} value={r.id}>{r.nombre} ({r.porcentaje}%)</option>)}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          {editandoId && <button onClick={cancelarEdicion} className="px-4 py-2 text-sm font-bold text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)]">Cancelar</button>}
          <button onClick={guardar} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {editandoId ? 'Guardar cambios' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]">
          <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Clientes registrados</h2>
        </div>
        {loading ? (
          <div className="p-5 text-sm text-[var(--text-muted)]">Cargando…</div>
        ) : clientes.length === 0 ? (
          <div className="p-5 text-sm text-[var(--text-faint)] italic">Sin clientes todavía.</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase text-[var(--text-faint)] border-b border-[var(--border)]">
              <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">Vendedor</th><th className="px-4 py-2">RFC</th><th className="px-4 py-2 text-right">Rango</th><th className="px-4 py-2 text-right"></th>
            </tr></thead>
            <tbody>
              {clientes.map((c) => (
                <tr key={c.id} className={cn('border-b border-[var(--border)] last:border-0', !c.activo && 'opacity-50')}>
                  <td className="px-4 py-2 text-[var(--text)]">{c.nombre}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{c.vendedor?.nombre || '—'}</td>
                  <td className="px-4 py-2 text-[var(--text-muted)]">{c.rfc || '—'}</td>
                  <td className="px-4 py-2 text-right text-[var(--text)]">{c.rango ? `${c.rango.nombre} (${c.rango.porcentaje}%)` : '—'}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button onClick={() => editar(c)} className="text-[var(--text-faint)] hover:text-[var(--accent)] mr-2" title="Editar"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => toggleActivo(c)} className={c.activo ? 'text-[var(--text-faint)] hover:text-[var(--err)]' : 'text-[var(--ok)]'} title={c.activo ? 'Desactivar' : 'Reactivar'}>
                      {c.activo ? <Ban className="w-4 h-4" /> : <CircleCheck className="w-4 h-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
