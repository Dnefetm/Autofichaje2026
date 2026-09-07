"use client";

import { useState } from 'react';
import { Save, Check, AlertCircle, Loader2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { cn } from '@/lib/utils';

type TipoMovimiento = 'ingreso' | 'egreso';

type Campo = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'textarea' | 'datetime-local';
  required?: boolean;
  ancho?: 'full';
};

// Campos que acepta /api/movimientos (rama tipo='ingreso' y tipo='egreso').
// Los `key` coinciden 1:1 con los nombres que espera route.ts.
const CAMPOS_INGRESO: Campo[] = [
  { key: 'ingreso_id', label: 'ID Ingreso', type: 'text', required: true },
  { key: 'articulo_id', label: 'Artículo (SKU)', type: 'text', required: true },
  { key: 'cantidad', label: 'Cantidad', type: 'number', required: true },
  { key: 'guia', label: 'Guía', type: 'text' },
  { key: 'transportista', label: 'Transportista', type: 'text' },
  { key: 'tipo_ingreso', label: 'Tipo de ingreso', type: 'text' },
  { key: 'notas', label: 'Notas', type: 'textarea', ancho: 'full' },
  { key: 'fecha', label: 'Fecha', type: 'datetime-local' },
  { key: 'operador_id', label: 'Operador', type: 'text' },
];

const CAMPOS_EGRESO: Campo[] = [
  { key: 'egreso_id', label: 'ID Egreso', type: 'text', required: true },
  { key: 'articulo_id', label: 'Artículo (SKU)', type: 'text', required: true },
  { key: 'cantidad', label: 'Cantidad', type: 'number', required: true },
  { key: 'tipo_egreso', label: 'Tipo de egreso', type: 'text' },
  { key: 'importacion_full_id', label: 'Importación Full ID', type: 'text' },
  { key: 'guia', label: 'Guía', type: 'text' },
  { key: 'transportista', label: 'Transportista', type: 'text' },
  { key: 'operador_id', label: 'Operador', type: 'text' },
  { key: 'notas', label: 'Notas', type: 'textarea', ancho: 'full' },
  { key: 'fecha', label: 'Fecha', type: 'datetime-local' },
  { key: 'largo', label: 'Largo', type: 'number' },
  { key: 'ancho', label: 'Ancho', type: 'number' },
  { key: 'alto', label: 'Alto', type: 'number' },
  { key: 'peso', label: 'Peso', type: 'number' },
  { key: 'salidas_periodo', label: 'Salidas período', type: 'number' },
  { key: 'codigo_ml', label: 'Código ML', type: 'text' },
  { key: 'edo_reunido', label: 'Estado reunido', type: 'text' },
  { key: 'fecha_reunido', label: 'Fecha reunido', type: 'datetime-local' },
  { key: 'fecha_preparado', label: 'Fecha preparado', type: 'datetime-local' },
];

function aNumero(v: string | undefined): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function aTexto(v: string | undefined): string | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  return String(v).trim();
}

function aFecha(v: string | undefined): string | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function MovementForm() {
  const [tipo, setTipo] = useState<TipoMovimiento>('ingreso');
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const campos = tipo === 'ingreso' ? CAMPOS_INGRESO : CAMPOS_EGRESO;

  function setCampo(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function cambiarTipo(t: TipoMovimiento) {
    setTipo(t);
    setError(null);
    setSuccess(false);
  }

  async function guardar() {
    for (const c of campos) {
      if (c.required && !aTexto(form[c.key])) {
        setError(`Falta el campo requerido: ${c.label}`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    const payload: Record<string, unknown> = { tipo };

    if (tipo === 'ingreso') {
      payload.ingreso_id = aTexto(form.ingreso_id);
      payload.articulo_id = aTexto(form.articulo_id);
      payload.cantidad = aNumero(form.cantidad);
      payload.guia = aTexto(form.guia);
      payload.transportista = aTexto(form.transportista);
      payload.tipo_ingreso = aTexto(form.tipo_ingreso);
      payload.notas = aTexto(form.notas);
      payload.fecha = aFecha(form.fecha);
      payload.operador_id = aTexto(form.operador_id);
    } else {
      payload.egreso_id = aTexto(form.egreso_id);
      payload.articulo_id = aTexto(form.articulo_id);
      payload.cantidad = aNumero(form.cantidad);
      payload.tipo_egreso = aTexto(form.tipo_egreso);
      payload.importacion_full_id = aTexto(form.importacion_full_id);
      payload.guia = aTexto(form.guia);
      payload.transportista = aTexto(form.transportista);
      payload.operador_id = aTexto(form.operador_id);
      payload.notas = aTexto(form.notas);
      payload.fecha = aFecha(form.fecha);
      payload.largo = aNumero(form.largo);
      payload.ancho = aNumero(form.ancho);
      payload.alto = aNumero(form.alto);
      payload.peso = aNumero(form.peso);
      payload.salidas_periodo = aNumero(form.salidas_periodo);
      payload.codigo_ml = aTexto(form.codigo_ml);
      payload.edo_reunido = aTexto(form.edo_reunido);
      payload.fecha_reunido = aFecha(form.fecha_reunido);
      payload.fecha_preparado = aFecha(form.fecha_preparado);
    }

    try {
      const res = await fetch('/api/movimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error al guardar');
      setSuccess(true);
      setForm({});
      setTimeout(() => setSuccess(false), 4000);
    } catch (e: any) {
      setError(e.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  const inputBase =
    'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--radius-sm)] ' +
    'px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] ' +
    'focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/50 focus:border-[var(--accent)] transition-colors';

  return (
    <div className="bg-[var(--surface)] rounded-[var(--radius)] border border-[var(--border)] shadow-sm overflow-hidden">
      {/* Encabezado + toggle */}
      <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Registrar Movimiento</h2>
        <div className="flex rounded-[var(--radius-sm)] border border-[var(--border)] overflow-hidden shrink-0">
          <button
            onClick={() => cambiarTipo('ingreso')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-colors',
              tipo === 'ingreso' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            <ArrowDownToLine className="w-3.5 h-3.5" /> Ingreso
          </button>
          <button
            onClick={() => cambiarTipo('egreso')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition-colors',
              tipo === 'egreso' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            )}
          >
            <ArrowUpFromLine className="w-3.5 h-3.5" /> Egreso
          </button>
        </div>
      </div>

      {/* Feedback */}
      {error && (
        <div className="px-5 py-2.5 text-sm text-[var(--err)] bg-[var(--err)]/10 border-b border-[var(--err)]/30 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="px-5 py-2.5 text-sm text-[var(--ok)] bg-[var(--ok)]/10 border-b border-[var(--ok)]/30 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" /> Movimiento guardado. Se reflejará en Sheets en el próximo ciclo.
        </div>
      )}

      {/* Campos */}
      <div className="p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {campos.map((campo) => (
            <div key={campo.key} className={campo.ancho === 'full' ? 'sm:col-span-2' : ''}>
              <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">
                {campo.label}
                {campo.required && <span className="text-[var(--err)] ml-0.5">*</span>}
              </label>
              {campo.type === 'textarea' ? (
                <textarea
                  value={form[campo.key] || ''}
                  onChange={(e) => setCampo(campo.key, e.target.value)}
                  rows={3}
                  className={cn(inputBase, 'resize-y')}
                />
              ) : (
                <input
                  type={campo.type}
                  value={form[campo.key] || ''}
                  onChange={(e) => setCampo(campo.key, e.target.value)}
                  inputMode={campo.type === 'number' ? 'decimal' : undefined}
                  step={campo.type === 'number' ? 'any' : undefined}
                  className={inputBase}
                />
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={guardar}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Guardando…' : 'Guardar movimiento'}
          </button>
        </div>
      </div>
    </div>
  );
}
