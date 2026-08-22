'use client';

import { useState } from 'react';
import { AlertCircle, ArrowRight, X, Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

type Props = {
  activa: { id: string; estado: string; nombre_archivo: string | null; creado_el: string };
  onContinuar: (id: string) => void;
  onCancelar: () => Promise<void>;
};

export function BannerImportacionActiva({ activa, onContinuar, onCancelar }: Props) {
  const [loadingCancelar, setLoadingCancelar] = useState(false);

  const handleCancelar = async () => {
    if (!confirm('¿Estás seguro que quieres cancelar esta importación? Perderás cualquier progreso actual.')) return;
    try {
      setLoadingCancelar(true);
      await onCancelar();
    } catch (err: any) {
      // Use sonner toast to show the exact error (imported dynamically or assume toast exists in scope, or just alert)
      alert('Error cancelando: ' + (err?.message || err));
    } finally {
      setLoadingCancelar(false);
    }
  };

  return (
    <div className="bg-[var(--warn)]/10 border border-[var(--warn)]/30 rounded-xl p-4 sm:p-5 flex flex-col gap-4 shadow-sm relative overflow-hidden">
      <div className="flex gap-3">
        <div className="text-amber-500 mt-0.5 shrink-0">
          <AlertCircle className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-amber-800 font-bold text-sm">Hay una importación en curso para este proveedor</h3>
          <p className="text-[var(--warn)] text-sm mt-1">
            Archivo: <span className="font-semibold">{activa.nombre_archivo || 'Documento sin nombrar'}</span>
            <br />
            Estado de tabla: <span className="font-semibold uppercase tracking-wide text-xs bg-amber-200/50 px-1 py-0.5 rounded mr-2">{activa.estado}</span>
             Iniciada {formatDistanceToNow(new Date(activa.creado_el), { addSuffix: true, locale: es })}
          </p>
        </div>
      </div>
      
      <div className="flex flex-wrap items-center gap-3 pl-8">
        <button
          className="bg-amber-600 hover:bg-amber-700 text-[var(--accent-ink)] font-semibold text-sm px-4 py-2 rounded-lg flex items-center gap-2 transition-colors focus:ring-2 ring-amber-400 outline-none"
          onClick={() => onContinuar(activa.id)}
        >
          Retomar Importación Central <ArrowRight className="w-4 h-4" />
        </button>
        <button
          className="bg-[var(--surface)] hover:bg-amber-100 text-amber-800 border border-amber-300 font-semibold text-sm px-4 py-2 rounded-lg transition-colors flex items-center gap-2 focus:ring-2 outline-none"
          onClick={handleCancelar}
          disabled={loadingCancelar}
        >
          {loadingCancelar ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          Descartar Importación
        </button>
      </div>
    </div>
  );
}
