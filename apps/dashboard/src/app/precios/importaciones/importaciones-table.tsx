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
      <div className="bg-white border border-slate-200 rounded-xl py-24 text-center">
        <FileText className="w-12 h-12 text-slate-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-slate-800">No hay importaciones aún</h3>
        <p className="text-slate-500 mt-2">Sube tu primer Excel desde "Nueva importación".</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
            <tr>
              <th className="px-6 py-4">Proveedor</th>
              <th className="px-6 py-4">Archivo</th>
              <th className="px-6 py-4">Estado</th>
              <th className="px-6 py-4 w-48">Progreso</th>
              <th className="px-6 py-4">Creado</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="font-semibold text-slate-800">{row.proveedor || 'Sin proveedor'}</div>
                </td>
                <td className="px-6 py-4 max-w-[200px] truncate" title={row.nombre_archivo}>
                  <div className="text-slate-600 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    {row.nombre_archivo}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <BadgeEstado estado={row.estado} />
                </td>
                <td className="px-6 py-4">
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{row.filas_procesadas} / {row.total_filas}</span>
                      <span className="font-semibold">{Math.round(row.pct_progreso)}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full transition-all duration-500 ease-out", 
                          ['mapeando', 'procesando'].includes(row.estado) ? "bg-indigo-500" :
                          row.estado === 'error' ? "bg-rose-500" : "bg-emerald-500"
                        )} 
                        style={{ width: `${Math.max(row.pct_progreso, 0)}%` }} 
                      />
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-500">
                  {formatDistanceToNow(new Date(row.created_at), { addSuffix: true, locale: es })}
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-2 text-slate-400">
                    {row.estado === 'en_revision' && (
                      <button onClick={() => router.push(`/precios/importar?id=${row.id}&step=3`)} className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors">
                        Revisar <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {row.estado === 'error' && (
                      <button onClick={() => handleAction(row.id, 'reintentar')} className="hover:text-amber-600 p-1.5 transition-colors title='Reintentar'">
                        <RefreshCcw className="w-4 h-4" />
                      </button>
                    )}
                    {['pendiente_mapeo', 'mapeando', 'procesando'].includes(row.estado) && (
                      <button onClick={() => handleAction(row.id, 'cancelar')} className="hover:text-slate-700 p-1.5 transition-colors title='Cancelar'">
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button disabled={deletingId === row.id} onClick={() => handleDelete(row.id, row.nombre_archivo)} className="hover:text-rose-600 p-1.5 transition-colors" title="Eliminar permanentemente">
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
    case 'pendiente_mapeo': return <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 font-semibold px-2.5 py-1 text-[11px] rounded-full"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div> Pendiente</span>;
    case 'mapeando': return <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 font-semibold px-2.5 py-1 text-[11px] rounded-full"><div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div> Mapeando</span>;
    case 'procesando': return <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-700 font-semibold px-2.5 py-1 text-[11px] rounded-full"><div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></div> Procesando</span>;
    case 'en_revision': return <span className="inline-flex items-center gap-1.5 bg-amber-50 text-amber-700 font-semibold px-2.5 py-1 text-[11px] rounded-full"><AlertTriangle className="w-3 h-3 text-amber-500" /> Requiere Revisión</span>;
    case 'completado': return <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 font-semibold px-2.5 py-1 text-[11px] rounded-full"><CheckCircle2 className="w-3 h-3 text-emerald-500" /> Completado</span>;
    case 'error': return <span className="inline-flex items-center gap-1.5 bg-rose-50 text-rose-700 font-semibold px-2.5 py-1 text-[11px] rounded-full"><XCircle className="w-3 h-3 text-rose-500" /> Fallido</span>;
    case 'cancelado': return <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-500 font-semibold px-2.5 py-1 text-[11px] rounded-full line-through"><div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div> Cancelado</span>;
    default: return <span className="inline-flex items-center gap-1.5 bg-slate-50 text-slate-600 font-semibold px-2.5 py-1 text-[11px] rounded-full"><div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div> Desconocido</span>;
  }
}
