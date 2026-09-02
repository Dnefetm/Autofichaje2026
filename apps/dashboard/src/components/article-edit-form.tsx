"use client";

import { useState } from 'react';
import { Pencil, X, Check, AlertCircle, Save, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  article: any;
  onSaved: () => void;
};

// Definición de campos editables (mismo orden y nombres que el RPC web_upsert_articulo).
// `ancho: 'full'` = ocupa las 2 columnas en escritorio; el resto se reparte en 2 columnas.
type Campo = { key: string; label: string; type: 'text' | 'number' | 'textarea'; ancho?: 'full' };

const GRUPOS: { titulo: string; campos: Campo[] }[] = [
  {
    titulo: 'Identidad',
    campos: [
      { key: 'nombre', label: 'Nombre', type: 'text', ancho: 'full' },
      { key: 'marca', label: 'Marca', type: 'text' },
      { key: 'modelo', label: 'Modelo', type: 'text' },
      { key: 'variante', label: 'Variante', type: 'text' },
      { key: 'categoria', label: 'Categoría', type: 'text' },
    ],
  },
  {
    titulo: 'Códigos y logística',
    campos: [
      { key: 'codigo_universal', label: 'Código Universal (UPC/EAN)', type: 'text' },
      { key: 'codigo_sat', label: 'Código SAT', type: 'text' },
      { key: 'caja_madre', label: 'Caja Madre', type: 'text' },
      { key: 'peso_kg', label: 'Peso (kg)', type: 'number' },
      { key: 'largo_cm', label: 'Largo (cm)', type: 'number' },
      { key: 'ancho_cm', label: 'Ancho (cm)', type: 'number' },
      { key: 'alto_cm', label: 'Alto (cm)', type: 'number' },
    ],
  },
  {
    titulo: 'Descripción y notas',
    campos: [
      { key: 'descripcion', label: 'Descripción', type: 'textarea', ancho: 'full' },
      { key: 'notas', label: 'Notas', type: 'textarea', ancho: 'full' },
      { key: 'url_producto', label: 'URL Producto', type: 'text', ancho: 'full' },
    ],
  },
];

const FLAGS: { key: string; label: string }[] = [
  { key: 'es_full', label: 'Es Full' },
  { key: 'es_dropshipping', label: 'Es Dropshipping' },
];

function toStr(v: any): string {
  return v === null || v === undefined ? '' : String(v);
}

function toNum(v: any): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function initForm(article: any): Record<string, any> {
  const form: Record<string, any> = {};
  GRUPOS.forEach(g => g.campos.forEach(c => { form[c.key] = toStr(article[c.key]); }));
  FLAGS.forEach(f => { form[f.key] = article[f.key] === true; });
  return form;
}

export function ArticleEditForm({ article, onSaved }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, any>>(() => initForm(article));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function startEdit() {
    setForm(initForm(article));
    setError(null);
    setSuccess(false);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  function setField(key: string, value: any) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/movimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'articulo',
          articulo_id: article.articulo_id,
          nombre: form.nombre || null,
          marca: form.marca || null,
          modelo: form.modelo || null,
          variante: form.variante || null,
          categoria: form.categoria || null,
          caja_madre: form.caja_madre || null,
          codigo_universal: form.codigo_universal || null,
          codigo_sat: form.codigo_sat || null,
          url_producto: form.url_producto || null,
          notas: form.notas || null,
          peso_kg: toNum(form.peso_kg),
          es_full: form.es_full === true,
          es_dropshipping: form.es_dropshipping === true,
          descripcion: form.descripcion || null,
          largo_cm: toNum(form.largo_cm),
          ancho_cm: toNum(form.ancho_cm),
          alto_cm: toNum(form.alto_cm),
          imagenes: article.imagenes ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error al guardar');
      setSuccess(true);
      setEditing(false);
      onSaved();
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
      {/* Encabezado */}
      <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="text-sm font-bold text-[var(--text)] uppercase tracking-wider">Datos del Artículo</h2>
          <span className="text-[10px] text-[var(--text-faint)] font-mono truncate">{article.articulo_id}</span>
        </div>
        {editing ? (
          <span className="text-[10px] font-semibold text-[var(--warn)] uppercase tracking-wider shrink-0">Editando</span>
        ) : (
          <button
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 transition-colors shrink-0"
          >
            <Pencil className="w-3.5 h-3.5" /> Editar
          </button>
        )}
      </div>

      {/* Feedback */}
      {error && (
        <div className="px-5 py-2.5 text-sm text-[var(--err)] bg-[var(--err)]/10 border-b border-[var(--err)]/30 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div className="px-5 py-2.5 text-sm text-[var(--ok)] bg-[var(--ok)]/10 border-b border-[var(--ok)]/30 flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" /> Cambios guardados. Se reflejarán en Sheets en el próximo ciclo.
        </div>
      )}

      {/* Cuerpo */}
      <div className="p-5 space-y-6">
        {GRUPOS.map(grupo => (
          <div key={grupo.titulo}>
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-faint)] mb-3">{grupo.titulo}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {grupo.campos.map(campo => (
                <div key={campo.key} className={campo.ancho === 'full' ? 'sm:col-span-2' : ''}>
                  <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">
                    {campo.label}
                  </label>
                  {editing ? (
                    campo.type === 'textarea' ? (
                      <textarea
                        value={toStr(form[campo.key])}
                        onChange={e => setField(campo.key, e.target.value)}
                        rows={3}
                        className={cn(inputBase, 'resize-y')}
                      />
                    ) : (
                      <input
                        type={campo.type}
                        value={toStr(form[campo.key])}
                        onChange={e => setField(campo.key, e.target.value)}
                        inputMode={campo.type === 'number' ? 'decimal' : undefined}
                        step={campo.type === 'number' ? 'any' : undefined}
                        className={inputBase}
                      />
                    )
                  ) : (
                    <p className={cn(
                      'text-sm break-words min-h-[38px] flex items-center px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--surface-2)]',
                      form[campo.key] ? 'text-[var(--text)]' : 'text-[var(--text-faint)] italic'
                    )}>
                      {form[campo.key] || '—'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Flags */}
        <div>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-faint)] mb-3">Banderas</h3>
          <div className="flex flex-wrap gap-4">
            {FLAGS.map(flag => (
              <label key={flag.key} className="inline-flex items-center gap-2 cursor-pointer select-none">
                {editing ? (
                  <input
                    type="checkbox"
                    checked={form[flag.key] === true}
                    onChange={e => setField(flag.key, e.target.checked)}
                    className="w-4 h-4 accent-[var(--accent)]"
                  />
                ) : (
                  <span className={cn(
                    'w-4 h-4 rounded-sm border inline-flex items-center justify-center',
                    form[flag.key] ? 'bg-[var(--accent)] border-[var(--accent)]' : 'bg-[var(--surface-2)] border-[var(--border)]'
                  )}>
                    {form[flag.key] && <Check className="w-3 h-3 text-[var(--accent-ink)]" />}
                  </span>
                )}
                <span className="text-sm text-[var(--text-muted)]">{flag.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Acciones */}
      {editing && (
        <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-end gap-2">
          <button
            onClick={cancelEdit}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" /> Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-[var(--accent-ink)] bg-[var(--accent)] rounded-[var(--radius-sm)] hover:brightness-110 transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}
    </div>
  );
}
