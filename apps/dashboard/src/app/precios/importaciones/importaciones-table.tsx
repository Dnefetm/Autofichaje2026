'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { RefreshCcw, FileText, XCircle, Trash2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImportacionRow {
  id: string;
  proveedor: string;
  nombre_archivo: string;
  estado: string;
  total_filas: number;
  filas_procesadas: number;
  filas_con_match: number;
  pct_progreso: number;
  pct_match: number;
  error_mensaje: string | null;
  created_at: string;
  ultima_actividad: string;
  costos_count: number;
}

export function ImportacionesTable({ initial }: { initial: ImportacionRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<ImportacionRow[]>(initial);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const actives = rows.some((r) => ['pendiente_mapeo', 'mapeando', 'procesando'].includes(r.estado));
    if (!actives) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/precios/importaciones');
        const data = await res.json();
        if (data.ok) setRows(data.data);
      } catch (err) {
        toast.error('Error de red al actualizar estado');
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [rows]);

  const handleDelete = async (id: string, fileName: string) => {
    if (!window.confirm(`¿Seguro que deseas eliminar la importación del archivo ${fileName}? Se borrarán los costos asociados.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/precios/importaciones/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success('Importación eliminada');
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Error eliminando');
    } finally {
      setDeletingId(null);
    }
  };

  const handleAction = async (id: string, action: 'cancelar' | 'reintentar') => {
    try {
      const res = await fetch(`/api/precios/importaciones/${id}/${action}`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast.success(action === 'reintentar' ? 'Encolado para reintentar' : 'Cancelado correctamente');
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || `Error al ${action}`);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl py-24 text-center">
        <FileText className="w-12 h-12 text-[var(--text-faint)] mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-[var(--text)]">No hay importaciones aún</h3>
        <p className="text-[var(--text-muted)] mt-2">Sube tu primer Excel desde "Nueva importación".</p>
      </div>
    );
  }

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
      {/* Mobile: tarjetas apiladas (sin scroll horizontal) */}
      <div className="md:hidden divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <div key={row.id} className="p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-[var(--text)] text-sm">{row.proveedor || 'Sin proveedor'}</div>
              <BadgeEstado estado={row.estado} />
            </div>
            <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs">
              <FileText className="w-4 h-4 text-[var(--text-faint)] shrink-0" />
              <span className="truncate" title={row.nombre_archivo}>{row.nombre_archivo}</span>
            </div>
            {row.estado === 'error' && row.error_mensaje && (
              <div className="text-xs text-[var(--err)] font-medium bg-[var(--err)]/10 p-1.5 rounded">{row.error_mensaje}</div>
            )}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-[var(--text-muted)]">
                <span>{row.filas_procesadas} / {row.total_filas} filas</span>
                <span className="font-semibold">{Math.round(row.pct_progreso)}%</span>
              </div>
              <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                <div
                  className={cn("h-full transition-all duration-500 ease-out",
                    ['mapeando', 'procesando'].includes(row.estado) ? "bg-[var(--accent)]/100" :
                    row.estado === 'error' ? "bg-[var(--err)]/100" : "bg-[var(--ok)]/100"
                  )}
                  style={{ width: `${Math.max(row.pct_progreso, 0)}%` }}
                />
              </div>
            </div>
            <div className="text-xs text-[var(--text-faint)]">Creado {formatDistanceToNow(new Date(row.created_at), { addSuffix: true, locale: es })}</div>
            <div className="flex items-center gap-2 flex-wrap">
              {row.estado === 'en_revision' && (
                <button onClick={() => router.push(`/precios/importaciones/${row.id}`)} className="bg-[var(--warn)]/10 text-[var(--warn)] hover:bg-[var(--warn)]/20 px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-colors">Revisar Cambios <ArrowRight className="w-3.5 h-3.5" /></button>
              )}
              {row.estado === 'completado' && (
                <button onClick={() => router.push(`/precios/matching?importacion_id=${row.id}`)} className="bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-colors">Correr Matching <ArrowRight className="w-3.5 h-3.5" /></button>
              )}
              {row.estado === 'matching_completo' && (
                <button onClick={() => router.push(`/precios/matching?importacion_id=${row.id}`)} className="bg-[var(--ok)]/10 text-[var(--ok)] hover:bg-[var(--ok)]/20 px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-colors">Continuar Revisión <ArrowRight className="w-3.5 h-3.5" /></button>
              )}
              {['pendiente_mapeo', 'mapeando'].includes(row.estado) && (
                <button onClick={() => router.push(`/precios/matching?importacion_id=${row.id}`)} className="bg-[var(--info)]/10 text-[var(--info)] hover:bg-[var(--info)]/20 px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-colors">Mapear Columnas <ArrowRight className="w-3.5 h-3.5" /></button>
              )}
              <div className="flex items-center gap-2 ml-auto text-[var(--text-faint)]">
                {row.estado === 'error' && (
                  <button onClick={() => handleAction(row.id, 'reintentar')} className="hover:text-[var(--warn)] p-1.5 transition-colors" title="Reintentar"><RefreshCcw className="w-4 h-4" /></button>
                )}
                {['pendiente_mapeo', 'mapeando', 'procesando'].includes(row.estado) && (
                  <button onClick={() => handleAction(row.id, 'cancelar')} className="hover:text-[var(--text-muted)] p-1.5 transition-colors" title="Cancelar"><XCircle className="w-4 h-4" /></button>
                )}
                <button disabled={deletingId === row.id} onClick={() => handleDelete(row.id, row.nombre_archivo)} className="hover:text-[var(--err)] p-1.5 transition-colors" title="Eliminar permanentemente"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: tabla */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)] font-medium">
            <tr>
              <th className="px-6 py-4">Proveedor</th>
              <th className="px-6 py-4">Archivo</th>
              <th className="px-6 py-4">Estado</th>
              <th className="px-6 py-4 w-48">Progreso</th>
              <th className="px-6 py-4">Creado</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-[var(--bg)] transition-colors">
                <td className="px-6 py-4">
                  <div className="font-semibold text-[var(--text)]">{row.proveedor || 'Sin proveedor'}</div>
                </td>
                <td className="px-6 py-4 max-w-[200px] truncate" title={row.nombre_archivo}>
                  <div className="text-[var(--text-muted)] flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[var(--text-faint)] shrink-0" />
                    {row.nombre_archivo}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <BadgeEstado estado={row.estado} />
                  {row.estado === 'error' && row.error_mensaje && (
                    <div className="mt-1.5 text-xs text-[var(--err)] font-medium bg-[var(--err)]/10 p-1.5 rounded">
                      {row.error_mensaje}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-[var(--text-muted)]">
                      <span>{row.filas_procesadas} / {row.total_filas}</span>
                      <span className="font-semibold">{Math.round(row.pct_progreso)}%</span>
                    </div>
                    <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full transition-all duration-500 ease-out", 
                          ['mapeando', 'procesando'].includes(row.estado) ? "bg-[var(--accent)]/100" :
                          row.estado === 'error' ? "bg-[var(--err)]/100" : "bg-[var(--ok)]/100"
                        )} 
                        style={{ width: `${Math.max(row.pct_progreso, 0)}%` }} 
                      />
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-[var(--text-muted)]">
                  {formatDistanceToNow(new Date(row.created_at), { addSuffix: true, locale: es })}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2 text-[var(--text-faint)]">
                    {row.estado === 'en_revision' && (
                      <button onClick={() => router.push(`/precios/importaciones/${row.id}`)} className="bg-[var(--warn)]/10 text-[var(--warn)] hover:bg-[var(--warn)]/20 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors">
                        Revisar Cambios <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {row.estado === 'completado' && (
                       <button onClick={() => router.push(`/precios/matching?importacion_id=${row.id}`)} className="bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors">
                         Correr Matching <ArrowRight className="w-3.5 h-3.5" />
                       </button>
                    )}
                    {row.estado === 'matching_completo' && (
                       <button onClick={() => router.push(`/precios/matching?importacion_id=${row.id}`)} className="bg-[var(--ok)]/10 text-[var(--ok)] hover:bg-[var(--ok)]/20 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors">
                         Continuar Revisión <ArrowRight className="w-3.5 h-3.5" />
                       </button>
                    )}
                    {['pendiente_mapeo', 'mapeando'].includes(row.estado) && (
                       <button onClick={() => router.push(`/precios/matching?importacion_id=${row.id}`)} className="bg-[var(--info)]/10 text-[var(--info)] hover:bg-[var(--info)]/20 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors">
                         Mapear Columnas <ArrowRight className="w-3.5 h-3.5" />
                       </button>
                    )}
                    {row.estado === 'error' && (
                      <button onClick={() => handleAction(row.id, 'reintentar')} className="hover:text-[var(--warn)] p-1.5 transition-colors title='Reintentar'">
                        <RefreshCcw className="w-4 h-4" />
                      </button>
                    )}
                    {['pendiente_mapeo', 'mapeando', 'procesando'].includes(row.estado) && (
                      <button onClick={() => handleAction(row.id, 'cancelar')} className="hover:text-[var(--text-muted)] p-1.5 transition-colors title='Cancelar'">
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button disabled={deletingId === row.id} onClick={() => handleDelete(row.id, row.nombre_archivo)} className="hover:text-[var(--err)] p-1.5 transition-colors" title="Eliminar permanentemente">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BadgeEstado({ estado }: { estado: string }) {
  switch (estado) {
    case 'pendiente_mapeo': return <span className="inline-flex items-center gap-1.5 bg-[var(--info)]/10 text-[var(--info)] font-semibold px-2.5 py-1 text-[11px] rounded-full"><div className="w-1.5 h-1.5 rounded-full bg-[var(--info)]"></div> Pendiente</span>;
    case 'mapeando': return <span className="inline-flex items-center gap-1.5 bg-[var(--info)]/10 text-[var(--info)] font-semibold px-2.5 py-1 text-[11px] rounded-full"><div className="w-1.5 h-1.5 rounded-full bg-[var(--info)]"></div> Mapeando</span>;
    case 'procesando': return <span className="inline-flex items-center gap-1.5 bg-[var(--accent)]/10 text-[var(--accent)] font-semibold px-2.5 py-1 text-[11px] rounded-full"><div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse"></div> Procesando</span>;
    case 'matching_completo': return <span className="inline-flex items-center gap-1.5 bg-[var(--ok)]/10 text-[var(--ok)] font-semibold px-2.5 py-1 text-[11px] rounded-full"><AlertTriangle className="w-3 h-3 text-[var(--ok)]" /> Revisión Matching</span>;
    case 'en_revision': return <span className="inline-flex items-center gap-1.5 bg-[var(--warn)]/10 text-[var(--warn)] font-semibold px-2.5 py-1 text-[11px] rounded-full"><AlertTriangle className="w-3 h-3 text-[var(--warn)]" /> Requiere Revisión</span>;
    case 'completado': return <span className="inline-flex items-center gap-1.5 bg-[var(--ok)]/10 text-[var(--ok)] font-semibold px-2.5 py-1 text-[11px] rounded-full"><CheckCircle2 className="w-3 h-3 text-[var(--ok)]" /> Completado</span>;
    case 'error': return <span className="inline-flex items-center gap-1.5 bg-[var(--err)]/10 text-[var(--err)] font-semibold px-2.5 py-1 text-[11px] rounded-full"><XCircle className="w-3 h-3 text-[var(--err)]" /> Fallido</span>;
    case 'cancelado': return <span className="inline-flex items-center gap-1.5 bg-[var(--surface-2)] text-[var(--text-muted)] font-semibold px-2.5 py-1 text-[11px] rounded-full line-through"><div className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]"></div> Cancelado</span>;
    default: return <span className="inline-flex items-center gap-1.5 bg-[var(--bg)] text-[var(--text-muted)] font-semibold px-2.5 py-1 text-[11px] rounded-full"><div className="w-1.5 h-1.5 rounded-full bg-[var(--text-faint)]"></div> Desconocido</span>;
  }
}
