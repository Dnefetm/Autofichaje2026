import React from 'react';
import { GrupoCostoFila } from './types';
import { cn } from '@/lib/utils';
import { Search, SkipForward, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';

interface Props {
  grupos: GrupoCostoFila[];
  selecciones: Record<string, string | null>;
  onSelectCandidato: (clave: string, articuloId: string | null) => void;
  onRemapClick: (clave: string) => void;
}

export function TablaComparacion({ grupos, selecciones, onSelectCandidato, onRemapClick }: Props) {
  
  const formatPrice = (v: number | undefined, currency: string | undefined) => {
     if (v === undefined || v === null) return '—';
     return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(v);
  };

  const computeDelta = (nuevo: number, anterior: number) => {
     if (!anterior) return <span className="text-[9px] font-bold text-emerald-600 bg-emerald-100/50 px-1 py-0.5 rounded">NUEVO</span>;
     const d = ((nuevo - anterior) / anterior) * 100;
     if (d === 0) return <span className="text-slate-400 font-medium">(Δ 0.0%)</span>;
     const sign = d > 0 ? '+' : '';
     const color = d > 0 ? "text-rose-500 font-semibold" : "text-emerald-600 font-semibold";
     return <span className={color}>(Δ {sign}{d.toFixed(1)}%)</span>;
  };

  return (
    <div className="flex flex-col gap-6">
      {grupos.map((g) => {
        const baseTiers = ['distribuidor', 'subdistribuidor', 'lista', 'mayoreo'];
        const hasOtro = g.precios_nuevos?.['otro'] || g.precios_anteriores?.['otro'];
        const tiersGrupo = hasOtro ? [...baseTiers, 'otro'] : baseTiers;
        const seleccionadoId = selecciones[g.clave];
        
        const tieneHistorico = g.precios_anteriores && Object.keys(g.precios_anteriores).length > 0;

        return (
          <div key={g.clave} className="flex bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden text-sm ring-1 ring-slate-100 hover:ring-indigo-100 transition-shadow">
            
            {/* ── Left Content Block (Lines 1-4) ── */}
            <div className="flex-1 flex flex-col min-w-0">
              
              {/* L1: Excel */}
              <div className="flex items-center gap-4 px-4 py-2 bg-slate-50 border-b border-slate-100">
                 <div className="w-14 text-[10px] uppercase text-slate-400 font-bold shrink-0 tracking-wider">L1 Excel</div>
                 <div className="w-28 shrink-0 font-bold text-slate-800 truncate">{g.excel.modelo || '—'}</div>
                 <div className="w-32 shrink-0 truncate text-violet-700 font-semibold">{g.excel.marca || '—'}</div>
                 <div className="w-36 shrink-0 font-mono text-xs text-slate-500 truncate">{g.excel.codigo_universal || '—'}</div>
                 <div className="flex-1 min-w-0 font-medium text-slate-600 pr-2">
                   <span className="block truncate" title={g.excel.descripcion || ''}>{g.excel.descripcion?.trim() || '—'}</span>
                 </div>
              </div>

              {/* L2: Catálogo */}
              <div className="flex items-center gap-4 px-4 py-2 bg-indigo-50/30 border-b border-slate-200 shadow-[inset_0_1px_4px_rgba(0,0,0,0.01)]">
                 <div className="w-14 text-[10px] uppercase text-indigo-400 font-bold shrink-0 tracking-wider">L2 Sugg.</div>
                 {g.catalogo_sugerido ? (
                   <>
                     <div className="w-28 shrink-0 font-bold text-slate-800 truncate">{g.catalogo_sugerido.modelo}</div>
                     <div className="w-32 shrink-0 text-slate-700 truncate">{g.catalogo_sugerido.marca}</div>
                     <div className="w-36 shrink-0 font-mono text-xs text-slate-500 truncate">{g.catalogo_sugerido.codigo_universal || '—'}</div>
                     <div className="flex-1 min-w-0 text-slate-600 flex justify-between items-center pr-2">
                       <span className="block truncate flex-1 min-w-0 mr-4" title={g.catalogo_sugerido.nombre || ''}>{g.catalogo_sugerido.nombre?.trim() || '—'}</span>
                       <div className="flex items-center gap-3 shrink-0 ml-auto break-keep whitespace-nowrap pt-0.5">
                         <span className="text-[11px] text-slate-500 truncate max-w-[150px]" title={g.catalogo_sugerido.caja_madre?.trim() || '—'}>
                           📍 <span className={cn("font-bold", g.catalogo_sugerido.caja_madre?.trim() ? "text-slate-800" : "text-slate-400")}>{g.catalogo_sugerido.caja_madre?.trim() || '—'}</span>
                         </span>
                         {(() => {
                           const s = g.catalogo_sugerido.puntaje_match;
                           const color = s >= 90 ? 'bg-emerald-100/80 text-emerald-700' : s >= 60 ? 'bg-amber-100/80 text-amber-700' : 'bg-rose-100/80 text-rose-700';
                           return (
                             <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded", color)}>{s}%</span>
                           );
                         })()}
                       </div>
                     </div>
                   </>
                 ) : (
                   <div className="text-xs italic text-slate-400 w-full">— Sin sugerencia de catálogo identificada —</div>
                 )}
              </div>

              {/* L3: Precios Nuevos (Excel) */}
              <div className="flex items-stretch gap-2 px-4 bg-emerald-50/20 border-b border-slate-100 relative">
                 <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-400/80"></div>
                 <div className="w-14 pl-2 text-[10px] uppercase text-emerald-600/80 font-bold shrink-0 tracking-wider flex items-center">L3 Nuevos</div>
                 <div className="flex-1 grid py-2.5" style={{ gridTemplateColumns: `repeat(${tiersGrupo.length}, minmax(120px, 1fr))` }}>
                    {tiersGrupo.map(t => {
                       const pn = g.precios_nuevos[t];
                       const pa = g.precios_anteriores?.[t];
                       const tierLabel = t === 'distribuidor' ? 'DISTRIB' : t === 'subdistribuidor' ? 'SUBDISTRIB' : t === 'lista' ? 'LISTA' : t === 'mayoreo' ? 'MAYOREO' : 'OTRO';
                       return (
                         <div key={t} className="flex flex-col justify-center px-3 border-l border-slate-200/60 first:border-l-0 min-w-0">
                            <span className="text-[10px] whitespace-nowrap tracking-wider text-emerald-700/60 font-bold mb-0.5">{tierLabel}</span>
                            <div className="flex flex-wrap items-baseline gap-1.5">
                              <span className={cn("text-sm font-semibold tabular-nums", pn ? "text-slate-900" : "text-slate-300")}>{formatPrice(pn?.valor, pn?.moneda)}</span>
                              {pn && (
                                <span className="text-[10px] shrink-0">
                                  {computeDelta(pn.valor, pa?.valor || 0)}
                                </span>
                              )}
                            </div>
                         </div>
                       )
                    })}
                 </div>
              </div>

              {/* L4: Precios Previos (Catálogo) */}
              {tieneHistorico ? (
                <div className="flex items-stretch gap-2 px-4 bg-slate-50/60">
                   <div className="w-14 text-[10px] uppercase text-slate-400 font-bold shrink-0 tracking-wider flex items-center">L4 Previos</div>
                   <div className="flex-1 grid py-2" style={{ gridTemplateColumns: `repeat(${tiersGrupo.length}, minmax(120px, 1fr))` }}>
                      {tiersGrupo.map(t => {
                         const pa = g.precios_anteriores?.[t];
                         return (
                           <div key={t} className="flex flex-col justify-center px-3 border-l border-slate-200/60 first:border-l-0 min-w-0">
                              <span className={cn("text-[11px] font-semibold tabular-nums", pa ? "text-slate-600" : "text-slate-300 italic")}>
                                {formatPrice(pa?.valor, pa?.moneda)}
                              </span>
                           </div>
                         )
                      })}
                   </div>
                </div>
              ) : (
                <div className="flex items-center px-4 py-2 bg-slate-50/60">
                   <div className="w-14 text-[10px] uppercase text-slate-400 font-bold shrink-0 tracking-wider">L4 Previos</div>
                   <span className="text-xs text-slate-400 italic px-3">— Sin precios anteriores registrados en catálogo —</span>
                </div>
              )}
            </div>

            {/* ── Right Action Block ── */}
            <div className="w-[360px] bg-slate-50/30 border-l border-slate-200 p-4 shrink-0 flex flex-col justify-center gap-3">
               
               <div className="flex justify-between items-center">
                  <div className="flex flex-col gap-1">
                     {seleccionadoId && g.candidatos_jsonb.find(c => c.articulo_id === seleccionadoId)?.metodo_match === 'manual' ? (
                        <span className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-fuchsia-100 text-fuchsia-700">MANUAL</span>
                     ) : g.estado_grupo === 'match' ? (
                        <span className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> EXACTO
                        </span>
                     ) : g.estado_grupo === 'duda' ? (
                        <span className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                          <AlertCircle className="w-3.5 h-3.5" /> REVISAR
                        </span>
                     ) : (
                        <span className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700">
                          <XCircle className="w-3.5 h-3.5" /> SIN MATCH
                        </span>
                     )}
                     
                     {/* Badge de método si aplica y NO es manual ni "sin match" */}
                     {g.catalogo_sugerido && g.estado_grupo !== 'sin_match' && g.catalogo_sugerido.metodo_match === 'codigo_exacto_incompleto' && (
                        <span className="text-[9px] w-fit text-amber-600 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                           Código ID ✓ | Marca/Mod ?
                        </span>
                     )}
                  </div>

                  <button
                    onClick={() => onRemapClick(g.clave)}
                    className="flex shrink-0 items-center justify-center p-2.5 text-slate-500 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-indigo-600 transition-all shadow-sm group"
                    title="Búsqueda libre en Catálogo"
                  >
                    <Search className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  </button>
               </div>

               <div className="flex flex-col gap-1 w-full relative mt-1">
                 <select
                   className={cn(
                     "w-full text-[11px] font-bold outline-none bg-white border rounded-lg px-2 py-2.5 transition-colors cursor-pointer",
                     seleccionadoId ? "border-indigo-400 text-indigo-900 ring-2 ring-indigo-50" : "border-slate-300 text-slate-500"
                   )}
                   value={seleccionadoId || 'none'}
                   onChange={(e) => onSelectCandidato(g.clave, e.target.value === 'none' ? null : e.target.value)}
                 >
                   <option value="none" className="italic text-slate-500 font-bold">-- Sin asignar (Saltar grupo) --</option>
                   {g.candidatos_jsonb.map((c) => {
                     const locOpt = c.caja_madre?.trim();
                     return (
                     <option key={c.articulo_id} value={c.articulo_id} className="text-slate-800 font-medium">
                       {c.puntaje_match}% | {c.marca} {c.modelo} ({c.nombre?.slice(0,18)}…) — 📍 {locOpt || '—'}
                     </option>
                     );
                   })}
                 </select>
               </div>
            </div>

          </div>
        );
      })}

      {grupos.length === 0 && (
        <div className="px-6 py-16 flex flex-col items-center justify-center bg-white rounded-xl border border-slate-200 border-dashed text-slate-400">
          <SkipForward className="w-10 h-10 mb-3 opacity-50" />
          <p className="font-semibold">Ningún grupo coincide</p>
          <p className="text-sm">Cambia tu búsqueda o filtro para ver resultados.</p>
        </div>
      )}
    </div>
  );
}
