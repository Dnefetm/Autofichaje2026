"use client";
import React, { useState, useEffect } from 'react';
import { X, Check, RefreshCw, Sparkles, FileText, CheckCheck } from 'lucide-react';

interface Campo {
  campo: string;
  label: string;
  tipo: 'texto' | 'numero';
  sintetizable: boolean;
  accion: 'agregar' | 'conflicto';
  valor_actual: any;
  valor_ficha: any;
}

interface CampoUI extends Campo {
  propuesta: any;
  origen: 'ficha' | 'sintesis';
  estado: 'pendiente' | 'aceptado' | 'rechazado' | 'sintetizando';
}

export default function RellenarDesdeFichaModal({
  articuloId,
  onClose,
  onSuccess,
}: {
  articuloId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [campos, setCampos] = useState<CampoUI[]>([]);
  const [ficha, setFicha] = useState<{ id: string; nombre_producto: string; estado: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articuloId]);

  async function cargar() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/articulos/${encodeURIComponent(articuloId)}/rellenar-desde-ficha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.codigo === 'sin_ficha') {
          setError('Este artículo no tiene ficha técnica asociada. Crea una ficha primero.');
        } else {
          setError(data.error || 'Error al cargar');
        }
        setLoading(false);
        return;
      }
      setFicha(data.ficha || null);
      setCampos(
        (data.campos || []).map((c: Campo) => ({
          ...c,
          propuesta: c.valor_ficha,
          origen: 'ficha',
          estado: 'pendiente',
        }))
      );
    } catch (e: any) {
      setError(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  }

  function patch(i: number, partial: Partial<CampoUI>) {
    setCampos((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...partial } : c)));
  }

  async function sintetizar(i: number) {
    const c = campos[i];
    patch(i, { estado: 'sintetizando' });
    try {
      const res = await fetch(`/api/articulos/${encodeURIComponent(articuloId)}/rellenar-sintetizar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campo: c.campo, label: c.label, valor_actual: c.valor_actual, valor_ficha: c.valor_ficha }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error de síntesis');
      patch(i, { propuesta: data.sugerencia, origen: 'sintesis', estado: 'pendiente' });
    } catch (e: any) {
      alert(e.message || 'Error al sintetizar');
      patch(i, { estado: 'pendiente' });
    }
  }

  function aceptarTodos() {
    setCampos((prev) => prev.map((c) => (c.estado === 'rechazado' ? c : { ...c, estado: 'aceptado' })));
  }

  async function aplicar() {
    const aceptados = campos.filter((c) => c.estado === 'aceptado');
    if (aceptados.length === 0) return;
    setSaving(true);
    try {
      const camposAceptados = Object.fromEntries(aceptados.map((c) => [c.campo, c.propuesta]));
      const res = await fetch(`/api/articulos/${encodeURIComponent(articuloId)}/rellenar-aplicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campos_aceptados: camposAceptados }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al aplicar');
      onSuccess();
      onClose();
    } catch (e: any) {
      alert(e.message || 'Error al aplicar');
    } finally {
      setSaving(false);
    }
  }

  const aceptadosCount = campos.filter((c) => c.estado === 'aceptado').length;

  function fmt(v: any): string {
    if (v === null || v === undefined || v === '') return '—';
    return String(v);
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85dvh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--text)]">Rellenar artículo desde ficha técnica</h2>
            {ficha && (
              <p className="text-xs text-[var(--text-muted)] truncate">
                {ficha.nombre_producto} · {ficha.estado}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--surface)] text-[var(--text-muted)] rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="py-16 text-center text-[var(--text-faint)] flex flex-col items-center gap-3">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <p className="text-sm">Comparando artículo con la ficha técnica…</p>
            </div>
          ) : error ? (
            <div className="py-16 text-center text-[var(--text-faint)] flex flex-col items-center gap-3">
              <FileText className="w-8 h-8 opacity-40" />
              <p className="text-sm max-w-sm">{error}</p>
            </div>
          ) : campos.length === 0 ? (
            <div className="py-16 text-center text-[var(--text-faint)] flex flex-col items-center gap-3">
              <CheckCheck className="w-8 h-8 opacity-40 text-[var(--ok)]" />
              <p className="text-sm">El artículo ya coincide con su ficha técnica. No hay nada que rellenar.</p>
            </div>
          ) : (
            campos.map((c, i) => {
              const aceptado = c.estado === 'aceptado';
              const rechazado = c.estado === 'rechazado';
              const sintetizando = c.estado === 'sintetizando';
              return (
                <div
                  key={c.campo}
                  className={`p-3 rounded-xl border transition-colors ${
                    aceptado
                      ? 'border-[var(--ok)]/50 bg-[var(--ok)]/5'
                      : rechazado
                      ? 'border-[var(--border)] bg-[var(--surface-2)]/30 opacity-50'
                      : 'border-[var(--border)] bg-[var(--surface-2)]/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-semibold text-[var(--text)]">{c.label}</span>
                      <span
                        className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                          c.accion === 'agregar'
                            ? 'bg-[var(--ok)]/15 text-[var(--ok)]'
                            : 'bg-[var(--warn)]/15 text-[var(--warn)]'
                        }`}
                      >
                        {c.accion === 'agregar' ? 'Vacío' : 'Conflicto'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => patch(i, { estado: 'aceptado' })}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          aceptado ? 'bg-[var(--ok)] text-[var(--accent-ink)]' : 'bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)] hover:border-[var(--ok)] hover:text-[var(--ok)]'
                        }`}
                        title="Aceptar"
                      >
                        <Check size={14} /> Aceptar
                      </button>
                      <button
                        onClick={() => patch(i, { estado: 'rechazado' })}
                        className="p-1.5 text-[var(--text-faint)] hover:text-[var(--err)] hover:bg-[var(--err)]/10 rounded-lg transition-colors"
                        title="Rechazar"
                      >
                        <X size={16} />
                      </button>
                      {c.sintetizable && (
                        <button
                          onClick={() => sintetizar(i)}
                          disabled={sintetizando}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/20 disabled:opacity-50 transition-colors"
                          title="Sintetizar con IA"
                        >
                          {sintetizando ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          Sintetizar
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1 text-xs">
                    <div className="flex gap-2">
                      <span className="text-[var(--text-faint)] shrink-0 w-16">Artículo:</span>
                      <span className={`text-[var(--text-muted)] break-words min-w-0 ${aceptado ? 'line-through' : ''}`}>{fmt(c.valor_actual)}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-[var(--text-faint)] shrink-0 w-16">Propuesta:</span>
                      <span className={`break-words min-w-0 font-medium ${c.origen === 'sintesis' ? 'text-[var(--info)]' : 'text-[var(--text)]'}`}>
                        {sintetizando ? 'Sintetizando…' : fmt(c.propuesta)}
                        {!sintetizando && c.origen === 'sintesis' && (
                          <span className="ml-1 text-[10px] font-bold text-[var(--info)]">(IA)</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {!loading && !error && campos.length > 0 && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border)] bg-[var(--surface)] shrink-0">
            <button
              onClick={aceptarTodos}
              className="text-xs font-semibold text-[var(--accent)] hover:underline"
            >
              Aceptar todos
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg hover:bg-[var(--surface-2)]/80 hover:text-[var(--text)] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={aplicar}
                disabled={saving || aceptadosCount === 0}
                className="px-5 py-2 text-sm font-semibold rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-110 disabled:opacity-40 flex items-center gap-2 transition-all"
              >
                {saving ? <RefreshCw size={16} className="animate-spin" /> : <Check size={16} />}
                Aplicar ({aceptadosCount})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
