import React from 'react';
import { FilaMapeada } from './types';
import { cn } from '@/lib/utils';
import { Search, SkipForward, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';

interface Props {
  filas: FilaMapeada[];
  onSelectCandidato: (costoId: string, articuloId: string | null) => void;
  onRemapClick: (costoId: string) => void;
}

export function TablaComparacion({ filas, onSelectCandidato, onRemapClick }: Props) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm bg-white">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 font-semibold text-slate-600">Fila (Excel)</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Costo ($)</th>
            <th className="px-4 py-3 font-semibold text-slate-600">Estado</th>
            <th className="px-4 py-3 font-semibold text-slate-600 w-[400px]">Candidato Seleccionado</th>
            <th className="px-4 py-3 font-semibold text-slate-600 text-center">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filas.map((f) => {
            const excelMarca = f.costo.marca_excel || '—';
            const excelModelo = f.costo.modelo_excel || '—';
            let bgRow = '';
            if (f.estado === 'match') bgRow = 'bg-emerald-50/50';
            else if (f.estado === 'duda') bgRow = 'bg-amber-50/50';
            else bgRow = 'bg-rose-50/50';

            return (
              <tr key={f.costo_id} className={cn("hover:bg-slate-50 transition-colors", bgRow)}>
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-800">{excelModelo}</span>
                    <span className="text-xs text-violet-600 font-semibold">{excelMarca}</span>
                    {f.costo.codigo_universal_excel && (
                      <span className="text-[10px] text-slate-400 font-mono mt-0.5">{f.costo.codigo_universal_excel}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-bold text-slate-700">
                      {new Intl.NumberFormat('es-MX', { style: 'currency', currency: f.costo.moneda }).format(f.costo.valor)}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded w-fit mt-1">
                      {f.costo.tipo_costo}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {f.estado === 'match' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" /> EXACTO
                    </span>
                  ) : f.estado === 'duda' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                      <AlertCircle className="w-3.5 h-3.5" /> REVISAR
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700">
                      <XCircle className="w-3.5 h-3.5" /> SIN MATCH
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1 w-full relative">
                    <select
                      className="w-full text-sm font-medium outline-none bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 truncate"
                      value={f.seleccionado || 'none'}
                      onChange={(e) => onSelectCandidato(f.costo_id, e.target.value === 'none' ? null : e.target.value)}
                    >
                      <option value="none" className="italic text-slate-500 font-bold">-- Sin asignar (Saltar) --</option>
                      {f.candidatos.map((c) => (
                        <option key={c.articulo_id} value={c.articulo_id}>
                          {c.puntaje_match}% | {c.marca} {c.modelo} ({c.nombre})
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => onRemapClick(f.costo_id)}
                    className="inline-flex items-center justify-center p-2 text-slate-500 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-indigo-600 transition-colors shadow-sm"
                    title="Búsqueda libre en Catálogo"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            );
          })}
          {filas.length === 0 && (
            <tr>
              <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                <SkipForward className="w-8 h-8 mx-auto mb-2 opacity-50" />
                Ninguna fila coincide con los filtros.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
