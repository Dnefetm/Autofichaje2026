'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { RefreshCcw, ActivitySquare, AlertTriangle, XCircle, ArrowRight, CheckCircle2, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabaseBrowser } from '@/lib/supabase-browser';

export function ProgresoImportacion({ id, initial }: { id: string, initial: any }) {
  const [isConsolidating, setIsConsolidating] = useState(false);
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [eventos, setEventos] = useState<any[]>([]);
  const supabase = supabaseBrowser();

  useEffect(() => {
    // Carga inicial de eventos
    supabase.from('importacion_eventos').select('*').eq('importacion_id', id).order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setEventos(data || []));

    // Suscripción Realtime a la tabla principal
    const chImp = supabase.channel('importaciones_update')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'importaciones_excel', filter: `id=eq.${id}` }, (payload) => {
         setS((prev: any) => ({ ...prev, ...payload.new }));
      })
      .subscribe();

    // Suscripción Realtime a eventos log
    const chEvt = supabase.channel('eventos_insert')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'importacion_eventos', filter: `importacion_id=eq.${id}` }, (payload) => {
         setEventos((prev) => [payload.new, ...prev].slice(0, 50));
      })
      .subscribe();

    return () => {
       supabase.removeChannel(chImp);
       supabase.removeChannel(chEvt);
    };
  }, [id, supabase]);

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
  
  // El dispatch directo se elimina para usar el motor de matching independiente en matching/page.tsx

  const getStatusInfo = () => {
    switch (s.estado) {
      case 'pendiente_mapeo': return { title: 'Pendiente', color: 'text-blue-500', bg: 'bg-blue-50' };
      case 'mapeando': return { title: 'Digeriendo Excel', color: 'text-blue-500', bg: 'bg-blue-50' };
      case 'procesando': return { title: 'Procesando el archivo...', color: 'text-indigo-500', bg: 'bg-indigo-50 animate-pulse' };
      case 'en_revision': return { title: 'Requiere revisión manual', color: 'text-amber-500', bg: 'bg-amber-50' };
      case 'error': return { title: 'Proceso fallido', color: 'text-rose-500', bg: 'bg-rose-50' };
      case 'cancelado': return { title: 'Importación cancelada', color: 'text-slate-500', bg: 'bg-slate-50' };
      case 'completado': return { title: 'Lista Vigente Registrada', color: 'text-emerald-500', bg: 'bg-emerald-50' };
      default: return { title: 'Preparando...', color: 'text-slate-500', bg: 'bg-slate-50' };
    }
  };

  const info = getStatusInfo();
  const pct = s.total_filas > 0 ? Math.min(100, Math.max(0, (s.filas_procesadas / s.total_filas) * 100)) : 0;

  return (
    <div className="bg-white border flex flex-col md:flex-row text-left border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      
      {/* Panel izquierdo: Estado */}
      <div className="flex-1 p-8 space-y-8 flex flex-col items-center justify-center border-r border-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className={cn("inline-flex items-center justify-center p-3 rounded-2xl", info.bg)}>
            {s.estado === 'procesando' || s.estado === 'mapeando' ? <ActivitySquare className={cn("w-8 h-8", info.color)} /> : 
             s.estado === 'en_revision' ? <AlertTriangle className={cn("w-8 h-8", info.color)} /> :
             s.estado === 'error' ? <XCircle className={cn("w-8 h-8", info.color)} /> :
             s.estado === 'completado' ? <CheckCircle2 className={cn("w-8 h-8", info.color)} /> :
             <RefreshCcw className={cn("w-8 h-8", info.color, ['pendiente_mapeo'].includes(s.estado) && "animate-spin")} />}
          </div>
          <h2 className="text-xl font-bold text-slate-800">{info.title}</h2>
        </div>

        <div className="w-full max-w-sm space-y-2">
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
          
          <p className="text-xs text-slate-400 font-medium text-center">
            Último latido: {s.heartbeat_at ? formatDistanceToNow(new Date(s.heartbeat_at), { addSuffix: true, locale: es }) : 'N/A'}
          </p>
        </div>

        <div className="flex justify-center pt-2 w-full">
           {s.estado === 'en_revision' && s.resumen_diff && (
             <div className="flex flex-col items-center gap-4 w-full">
                <div className="w-full bg-amber-50/50 border border-amber-200 p-4 rounded-xl flex flex-col sm:flex-row justify-around gap-4 shadow-sm">
                   <div className="text-center">
                     <span className="block text-2xl font-black text-emerald-600">{s.resumen_diff.nuevos ?? 0}</span>
                     <span className="text-xs uppercase font-bold text-slate-500">Nuevos</span>
                   </div>
                   <div className="text-center">
                     <span className="block text-2xl font-black text-indigo-600">{s.resumen_diff.modificados ?? 0}</span>
                     <span className="text-xs uppercase font-bold text-slate-500">Modificados</span>
                   </div>
                   <div className="text-center">
                     <span className="block text-2xl font-black text-rose-600">{s.resumen_diff.eliminados ?? 0}</span>
                     <span className="text-xs uppercase font-bold text-slate-500">Descontinuados</span>
                   </div>
                </div>
                <button 
                  disabled={isConsolidating}
                  onClick={async () => {
                     setIsConsolidating(true);
                     try {
                        const res = await fetch(`/api/precios/importaciones/${id}/consolidar-revision`, { 
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ aprobado: true })
                        });
                        if (!res.ok) throw new Error((await res.json()).error);
                        toast.success('Lista oficializada correctamente.');
                        setS((p: any) => ({ ...p, estado: 'completado' }));
                     } catch(e: any) {
                        toast.error(e.message || 'Error al consolidar');
                     } finally {
                        setIsConsolidating(false);
                     }
                  }}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-3 rounded-xl font-bold transition-all shadow shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isConsolidating ? 'Consolidando precios...' : 'Confirmar Efectividad de Cambios'}
                  {!isConsolidating && <ArrowRight className="w-4 h-4" />}
                </button>
             </div>
           )}

           {['completado', 'mapeando', 'error'].includes(s.estado) && (
             <button 
               onClick={() => router.push(`/precios/matching?importacion_id=${id}`)}
               className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow shadow-emerald-600/20"
             >
               Ir al Motor de Matching Independiente
               <ArrowRight className="w-4 h-4" />
             </button>
           )}

           {s.estado === 'error' && (
             <div className="flex flex-col items-center gap-4">
                <div className="bg-rose-50 text-rose-700 px-6 py-4 rounded-xl text-sm font-medium border border-rose-100 max-w-sm overflow-hidden break-words">
                   <span className="font-bold block mb-1">Error crítico:</span>
                   {s.error_mensaje || 'Fallo desconocido en el worker.'}
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

      {/* Panel derecho: Logs en tiempo real */}
      <div className="w-full md:w-96 bg-slate-900 flex flex-col max-h-[500px]">
         <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-black/20">
            <div className="flex items-center gap-2">
               <Terminal className="w-4 h-4 text-emerald-400" />
               <span className="text-xs font-mono font-bold text-slate-300">import_worker.log</span>
            </div>
            <div className="flex items-center gap-2">
               <span className="relative flex h-2 w-2">
                 <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", s.estado === 'mapeando' ? 'bg-emerald-400' : 'hidden')}></span>
                 <span className={cn("relative inline-flex rounded-full h-2 w-2", s.estado === 'mapeando' ? 'bg-emerald-500' : 'bg-slate-600')}></span>
               </span>
               <span className="text-[10px] text-slate-500 font-bold uppercase">{s.estado === 'mapeando' ? 'LIVE' : 'OFFLINE'}</span>
            </div>
         </div>
         <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px] leading-relaxed">
            {eventos.length === 0 ? (
               <p className="text-slate-600 italic">Esperando inicialización de worker...</p>
            ) : (
               eventos.map((ev, i) => (
                  <div key={ev.id} className={cn(
                     "border-l-2 pl-3 py-1",
                     ev.estado_paso.includes('ERROR') ? 'border-rose-500 text-rose-400' :
                     ev.estado_paso === 'COMPLETADO' ? 'border-emerald-500 text-emerald-400' :
                     ev.estado_paso === 'INICIO' ? 'border-indigo-500 text-indigo-400' :
                     'border-slate-700 text-slate-400'
                  )}>
                     <div className="flex justify-between items-start">
                        <span className="font-bold mix-blend-plus-lighter">{ev.estado_paso}</span>
                        <span className="text-[9px] text-slate-600 shrink-0">{new Date(ev.creado_el).toLocaleTimeString()}</span>
                     </div>
                     <p className="mt-0.5">{ev.mensaje}</p>
                  </div>
               ))
            )}
         </div>
      </div>
      
    </div>
  );
}
