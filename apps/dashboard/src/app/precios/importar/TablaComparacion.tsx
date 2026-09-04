import React from 'react';
import { GrupoCostoFila } from './types';
import { cn } from '@/lib/utils';
import { Search, SkipForward, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';

interface Props {
  grupos: GrupoCostoFila[];
  selecciones: Record<string, string | null>;
  onSelectCandidato: (clave: string, articuloId: string | null) => void;
  onRemapClick: (clave: string) => void;
  onDesvincularClick: (clave: string) => void;
}

export function TablaComparacion({ grupos, selecciones, onSelectCandidato, onRemapClick, onDesvincularClick }: Props) {
  
  const formatPrice = (v: number | undefined, currency: string | undefined) => {
     if (v === undefined || v === null) return '—';
     return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(v);
  };

  const computeDelta = (nuevo: number, anterior: number) => {
     if (!anterior) return <span className="text-[9px] font-bold text-[var(--ok)] bg-[var(--ok)]/10 px-1 py-0.5 rounded">NUEVO</span>;
     const d = ((nuevo - anterior) / anterior) * 100;
     if (d === 0) return <span className="text-[var(--text-faint)] font-medium">(Δ 0.0%)</span>;
     const sign = d > 0 ? '+' : '';
     const color = d > 0 ? "text-[var(--err)] font-semibold" : "text-[var(--ok)] font-semibold";
     return <span className={color}>(Δ {sign}{d.toFixed(1)}%)</span>;
  };

  return (
    <div className="flex flex-col gap-6">
      {grupos.map((g) => {
        const baseTiers = ['distribuidor', 'subdistribuidor', 'menudeo', 'mayoreo'];
        const hasOtro = g.precios_nuevos?.['otro'] || g.precios_anteriores?.['otro'];
        const tiersGrupo = hasOtro ? [...baseTiers, 'otro'] : baseTiers;
        const seleccionadoId = selecciones[g.clave];
        
        const tieneHistorico = g.precios_anteriores && Object.keys(g.precios_anteriores).length > 0;

        return (
          <div key={g.clave} className="flex bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm text-sm ring-1 ring-[var(--border)] hover:ring-[var(--accent)]/10 transition-shadow">
            
            {/* -- Left Content Block (Lines 1-4) -- */}
            <div className="flex-1 flex flex-col min-w-0">
              
              {/* L1: Excel */}
              <div className="grid grid-cols-[70px_80px_100px_130px_minmax(0,1fr)] items-center gap-2 px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)]">
                 <div className="text-[10px] uppercase text-[var(--text-faint)] font-bold truncate tracking-wider">L1 Excel</div>
                 <div className="font-bold text-[var(--text)] truncate" title={g.excel.modelo || ''}>{g.excel.modelo || '—'}</div>
                 <div className="truncate text-violet-300 font-semibold" title={g.excel.marca || ''}>{g.excel.marca || '—'}</div>
                 <div className="font-mono text-xs text-[var(--text-muted)] truncate" title={g.excel.codigo_universal || ''}>{g.excel.codigo_universal || '—'}</div>
                 <div className="truncate min-w-0 font-medium text-[var(--text-muted)] pr-2" title={g.excel.descripcion || ''}>
                   {g.excel.descripcion?.trim() || '—'}
                 </div>
              </div>

              {/* L2: Catálogo */}
              <div className="grid grid-cols-[70px_80px_100px_130px_minmax(0,1fr)] items-center gap-2 px-4 py-2 bg-[var(--accent)]/10/30 border-b border-[var(--border)] shadow-[inset_0_1px_4px_rgba(0,0,0,0.01)]">
                 <div className="text-[10px] uppercase text-[var(--accent)] font-bold truncate tracking-wider">L2 Sugg.</div>
                 {g.catalogo_sugerido ? (
                   <>
                     <div className="font-bold text-[var(--text)] truncate" title={g.catalogo_sugerido.modelo}>{g.catalogo_sugerido.modelo}</div>
                     <div className="text-[var(--text-muted)] truncate" title={g.catalogo_sugerido.marca}>{g.catalogo_sugerido.marca}</div>
                     <div className="font-mono text-xs text-[var(--text-muted)] truncate" title={g.catalogo_sugerido.codigo_universal || ''}>{g.catalogo_sugerido.codigo_universal || '—'}</div>
                     <div className="truncate min-w-0 font-medium text-[var(--text-muted)] pr-2" title={g.catalogo_sugerido.nombre || ''}>
                       {g.catalogo_sugerido.nombre?.trim() || '—'}
                     </div>
                   </>
                 ) : (
                   <div className="col-span-4 text-xs italic text-[var(--text-faint)]">— Sin sugerencia de catálogo identificada —</div>
                 )}
              </div>

              {/* L3: Precios Nuevos (Excel) */}
              <div className="flex items-stretch gap-2 px-4 bg-[var(--ok)]/10/20 border-b border-[var(--border)] relative">
                 <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--ok)]/80"></div>
                 <div className="w-14 pl-2 text-[10px] uppercase text-[var(--ok)]/80 font-bold shrink-0 tracking-wider flex items-center">L3 Nuevos</div>
                 <div className="flex-1 grid py-2.5" style={{ gridTemplateColumns: `repeat(${tiersGrupo.length}, minmax(120px, 1fr))` }}>
                    {tiersGrupo.map(t => {
                       const pn = g.precios_nuevos[t];
                       const pa = g.precios_anteriores?.[t];
                       const tierLabel = t === 'distribuidor' ? 'DISTRIB' : t === 'subdistribuidor' ? 'SUBDISTRIB' : t === 'menudeo' ? 'MENUDEO' : t === 'mayoreo' ? 'MAYOREO' : 'OTRO';
                       return (
                         <div key={t} className="flex flex-col justify-center px-3 border-l border-[var(--border)]/60 first:border-l-0 min-w-0">
                            <span className="text-[10px] whitespace-nowrap tracking-wider text-[var(--ok)]/60 font-bold mb-0.5">{tierLabel}</span>
                            <div className="flex flex-wrap items-baseline gap-1.5">
                              <span className={cn("text-sm font-semibold tabular-nums", pn ? "text-[var(--text)]" : "text-[var(--text-faint)]")}>{formatPrice(pn?.valor, pn?.moneda)}</span>
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
                <div className="flex items-stretch gap-2 px-4 bg-[var(--bg)]/60">
                   <div className="w-14 text-[10px] uppercase text-[var(--text-faint)] font-bold shrink-0 tracking-wider flex items-center">L4 Previos</div>
                   <div className="flex-1 grid py-2" style={{ gridTemplateColumns: `repeat(${tiersGrupo.length}, minmax(120px, 1fr))` }}>
                      {tiersGrupo.map(t => {
                         const pa = g.precios_anteriores?.[t];
                         return (
                           <div key={t} className="flex flex-col justify-center px-3 border-l border-[var(--border)]/60 first:border-l-0 min-w-0">
                              <span className={cn("text-[11px] font-semibold tabular-nums", pa ? "text-[var(--text-muted)]" : "text-[var(--text-faint)] italic")}>
                                {formatPrice(pa?.valor, pa?.moneda)}
                              </span>
                           </div>
                         )
                      })}
                   </div>
                </div>
              ) : (
                <div className="flex items-center px-4 py-2 bg-[var(--bg)]/60">
                   <div className="w-14 text-[10px] uppercase text-[var(--text-faint)] font-bold shrink-0 tracking-wider">L4 Previos</div>
                   <span className="text-xs text-[var(--text-faint)] italic px-3">— Sin precios anteriores registrados en catálogo —</span>
                </div>
              )}
            </div>

            {/* -- Right Action Block -- */}
            <div className="w-[300px] bg-[var(--bg)]/30 border-l border-[var(--border)] p-4 shrink-0 flex flex-col justify-center gap-3">
               
               <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-1.5">
                     {seleccionadoId && g.candidatos_jsonb.find(c => c.articulo_id === seleccionadoId)?.metodo_match === 'manual' ? (
                        <span className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-fuchsia-500/10 text-fuchsia-300">MANUAL</span>
                     ) : g.estado_grupo === 'match_exacto' ? (
                        <span className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--ok)]/10 text-[var(--ok)]">
                          <CheckCircle2 className="w-3.5 h-3.5" /> EXACTO
                        </span>
                     ) : g.estado_grupo === 'match_similitud' ? (
                        <span className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--warn)]/10 text-[var(--warn)]">
                          <AlertCircle className="w-3.5 h-3.5" /> REVISAR
                        </span>
                     ) : (
                        <span className="inline-flex w-fit items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-[var(--err)]/10 text-[var(--err)]">
                          <XCircle className="w-3.5 h-3.5" /> SIN MATCH
                        </span>
                     )}
                     
                     {/* Badge de método si aplica y NO es manual ni "sin match" */}
                     {g.catalogo_sugerido && g.estado_grupo !== 'sin_match' && g.catalogo_sugerido.metodo_match === 'codigo_exacto_incompleto' && (
                        <span className="text-[9px] w-fit text-[var(--warn)] font-semibold bg-[var(--warn)]/10 px-1.5 py-0.5 rounded border border-[var(--warn)]/30">
                           Código ID ✓ | Marca/Mod ?
                        </span>
                     )}
                     
                     {g.catalogo_sugerido && (
                       <div className="flex items-center gap-2 mt-0.5">
                         {(() => {
                           const s = g.catalogo_sugerido.puntaje_match;
                           const color = s >= 90 ? 'bg-[var(--ok)]/10 text-[var(--ok)]' : s >= 60 ? 'bg-[var(--warn)]/10 text-[var(--warn)]' : 'bg-[var(--err)]/10 text-[var(--err)]';
                           return (
                             <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", color)}>{s}%</span>
                           );
                         })()}
                         <span className="text-[11px] text-[var(--text-muted)] truncate max-w-[120px]" title={g.catalogo_sugerido.caja_madre?.trim() || '—'}>
                           📍 <span className={cn("font-bold", g.catalogo_sugerido.caja_madre?.trim() ? "text-[var(--text)]" : "text-[var(--text-faint)]")}>{g.catalogo_sugerido.caja_madre?.trim() || '—'}</span>
                         </span>
                       </div>
                     )}
                  </div>

                  <button
                    onClick={() => onRemapClick(g.clave)}
                    className="flex shrink-0 items-center justify-center p-2.5 text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)] rounded-xl hover:bg-[var(--bg)] hover:text-[var(--accent)] transition-all shadow-sm group"
                    title="Búsqueda libre en Catálogo"
                  >
                    <Search className="w-4 h-4 group-hover:scale-110 transition-transform" />
                  </button>
               </div>

               <div className="flex flex-col gap-1 w-full relative mt-1">
                 {g.articulo_id_final ? (
                    <div className="flex items-center justify-between bg-[var(--ok)]/10 border border-[var(--ok)]/30 rounded-lg px-2 py-2 w-full">
                       <span className="text-[11px] font-bold text-[var(--ok)] flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5"/> VINCULADO</span>
                       <button onClick={() => onDesvincularClick(g.clave)} className="text-[10px] bg-[var(--err)]/10 hover:bg-[var(--err)]/20 text-[var(--err)] font-bold px-2 py-1 rounded transition-colors">
                          Desvincular
                       </button>
                    </div>
                 ) : (
                 <select
                   className={cn(
                     "w-full text-[11px] font-bold outline-none bg-[var(--surface)] border rounded-lg px-2 py-2.5 transition-colors cursor-pointer",
                     seleccionadoId ? "border-[var(--accent)]/70 text-[var(--accent)] ring-2 ring-[var(--accent)]/10" : "border-[var(--border)] text-[var(--text-muted)]"
                   )}
                   value={seleccionadoId || 'none'}
                   onChange={(e) => onSelectCandidato(g.clave, e.target.value === 'none' ? null : e.target.value)}
                 >
                   <option value="none" className="italic text-[var(--text-muted)] font-bold">-- Sin asignar (Saltar grupo) --</option>
                   {g.candidatos_jsonb.map((c) => {
                     const locOpt = c.caja_madre?.trim();
                     return (
                     <option key={c.articulo_id} value={c.articulo_id} className="text-[var(--text)] font-medium">
                       {c.puntaje_match}% | {c.marca} {c.modelo} ({c.nombre?.slice(0,18)}…) — 📍 {locOpt || '—'}
                     </option>
                     );
                   })}
                 </select>
                 )}
               </div>
            </div>

          </div>
        );
      })}

      {grupos.length === 0 && (
        <div className="px-6 py-16 flex flex-col items-center justify-center bg-[var(--surface)] rounded-xl border border-[var(--border)] border-dashed text-[var(--text-faint)]">
          <SkipForward className="w-10 h-10 mb-3 opacity-50" />
          <p className="font-semibold">Ningún grupo coincide</p>
          <p className="text-sm">Cambia tu búsqueda o filtro para ver resultados.</p>
        </div>
      )}
    </div>
  );
}
