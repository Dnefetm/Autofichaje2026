'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { RefreshCcw, ActivitySquare, AlertTriangle, XCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ProgresoImportacion({ id, initial }: { id: string, initial: any }) {
  const router = useRouter();
  const [s, setS] = useState(initial);

  useEffect(() => {
    // Si ya está en un estado final de polling, salir
    if (['en_revision', 'completado', 'error', 'cancelado'].includes(s.estado)) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/precios/importaciones/${id}/status`);
        const data = await res.json();
        if (data.ok && data.data) {
          setS(data.data);
        }
      } catch (err) {
        console.error('Error fetching status', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [s.estado, id]);

  const handleReintentar = async () => {
    try {
      const res = await fetch(`/api/precios/importaciones/${id}/reintentar`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      toast.success('Retomando proceso...');
      setS((prev: any) => ({ ...prev, estado: 'procesando' }));
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Error al reintentar');
    }
  };

  const getStatusInfo = () => {
    switch (s.estado) {
      case 'pendiente_mapeo': return { title: 'Pendiente', color: 'text-blue-500', bg: 'bg-blue-50' };
      case 'mapeando': return { title: 'Mapeando', color: 'text-blue-500', bg: 'bg-blue-50' };
      case 'procesando': return { title: 'Procesando el archivo...', color: 'text-indigo-500', bg: 'bg-indigo-50 animate-pulse' };
      case 'en_revision': return { title: 'Requiere revisión manual', color: 'text-amber-500', bg: 'bg-amber-50' };
      case 'error': return { title: 'Proceso fallido', color: 'text-rose-500', bg: 'bg-rose-50' };
      case 'cancelado': return { title: 'Importación cancelada', color: 'text-slate-500', bg: 'bg-slate-50' };
      case 'completado': return { title: 'Completado', color: 'text-emerald-500', bg: 'bg-emerald-50' };
      default: return { title: 'Preparando...', color: 'text-slate-500', bg: 'bg-slate-50' };
    }
  };

  const info = getStatusInfo();
  const pct = Math.max(0, s.pct_progreso || 0);

  return (
    <div className="bg-white border text-center border-slate-200 rounded-2xl shadow-sm p-8 space-y-8">
      
      {/* Title & Status indicator */}
      <div className="flex flex-col items-center gap-3">
        <div className={cn("inline-flex items-center justify-center p-3 rounded-2xl", info.bg)}>
          {s.estado === 'procesando' ? <ActivitySquare className={cn("w-8 h-8", info.color)} /> : 
           s.estado === 'en_revision' ? <AlertTriangle className={cn("w-8 h-8", info.color)} /> :
           s.estado === 'error' ? <XCircle className={cn("w-8 h-8", info.color)} /> :
           s.estado === 'completado' ? <CheckCircle2 className={cn("w-8 h-8", info.color)} /> :
           <RefreshCcw className={cn("w-8 h-8", info.color, ['pendiente_mapeo', 'mapeando'].includes(s.estado) && "animate-spin")} />}
        </div>
        <h2 className="text-xl font-bold text-slate-800">{info.title}</h2>
      </div>

      {/* Progress Bar Container */}
      <div className="max-w-xl mx-auto space-y-2">
        <div className="flex justify-between text-sm font-semibold text-slate-600 mb-1">
          <span>{s.filas_procesadas?.toLocaleString()} / {s.total_filas?.toLocaleString()} filas</span>
          <span>{pct.toFixed(0)}%</span>
        </div>
        
        <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden shadow-inner">
           <div 
             className={cn("h-full transition-all duration-1000 ease-out", 
               s.estado === 'error' ? "bg-rose-500" :
               s.estado === 'completado' ? "bg-emerald-500" :
               "bg-indigo-600"
             )}
             style={{ width: `${pct}%` }}
           />
        </div>
        
        <p className="text-xs text-slate-400 font-medium">
          Último heartbeat o actividad: {s.ultima_actividad ? formatDistanceToNow(new Date(s.ultima_actividad), { addSuffix: true, locale: es }) : 'N/A'}
        </p>
      </div>

      {/* Actions / States */}
      <div className="flex justify-center pt-2">
        {s.estado === 'en_revision' && (
          <button 
            onClick={() => router.push(`/precios/importar?id=${id}&step=3`)}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow shadow-emerald-600/20"
          >
            Continuar a revisar matches
            <ArrowRight className="w-4 h-4" />
          </button>
        )}

        {s.estado === 'error' && (
          <div className="flex flex-col items-center gap-4">
             <div className="bg-rose-50 text-rose-700 px-6 py-4 rounded-xl text-sm font-medium border border-rose-100 max-w-lg overflow-hidden break-words">
                <span className="font-bold block mb-1">Error reportado:</span>
                {s.error_mensaje || 'Error desconocido del motor.'}
             </div>
             <button 
               onClick={handleReintentar}
               className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-6 py-2.5 rounded-xl font-bold transition-all"
             >
               <RefreshCcw className="w-4 h-4" /> Reintentar
             </button>
          </div>
        )}

        {s.estado === 'cancelado' && (
           <button 
             onClick={handleReintentar}
             className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2.5 rounded-xl font-bold transition-all"
           >
             <RefreshCcw className="w-4 h-4" /> Reintentar
           </button>
        )}
      </div>
      
    </div>
  );
}
