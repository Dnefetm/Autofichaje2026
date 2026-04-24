'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, CheckCircle2, ChevronRight, ChevronLeft, Search, Save, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface DecisionRow {
  id: string;
  importacion_id: string;
  nivel: number;
  pct: number;
  preseleccionado: boolean;
  confirmado: boolean;
  cand_articulo_id: string | null;
  cand_marca: string | null;
  cand_modelo: string | null;
  cand_codigo: string | null;
  cand_nombre: string | null;
  articulo_id_final: string | null;
  proveedor: string;
  codigo_universal_excel: string | null;
  marca_excel: string | null;
  modelo_excel: string | null;
  nombre_excel: string | null;
}

export function PanelDecisiones({ importacionId, onBack }: { importacionId: string, onBack: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [nivelFilter, setNivelFilter] = useState<number>(1);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  const [dirtyRows, setDirtyRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchData();
  }, [nivelFilter, search, page]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const url = new URL(`/api/precios/importaciones/${importacionId}/matching/candidatos`, window.location.origin);
      url.searchParams.set('page', page.toString());
      url.searchParams.set('limit', '50');
      if (nivelFilter) url.searchParams.set('nivel', nivelFilter.toString());
      if (search) url.searchParams.set('q', search);

      const res = await fetch(url.toString());
      const d = await res.json();
      if (d.ok) {
        setData(d.data);
        setTotalPages(d.meta.totalPages || 1);
        setDirtyRows(new Set()); // reset dirty state on fetch
      } else {
        toast.error(d.error || 'Error al cargar candidatos');
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (id: string, updates: Partial<DecisionRow>) => {
    setData(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    setDirtyRows(prev => new Set(prev).add(id));
  };

  const handleSavePage = async () => {
    if (dirtyRows.size === 0) return;
    setSaving(true);
    try {
      const updates = Array.from(dirtyRows).map(id => {
        const r = data.find(x => x.id === id)!;
        return {
          id,
          articulo_id_final: r.articulo_id_final,
          confirmado: r.confirmado
        };
      });

      const res = await fetch(`/api/precios/importaciones/${importacionId}/matching/candidatos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error);
      
      toast.success('Cambios guardados en esta página');
      setDirtyRows(new Set());
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAll = async () => {
    if (!confirm('¿Seguro que deseas consolidar TODAS las filas confirmadas y aplicar los precios? Esto cerrará la revisión.')) return;
    
    // Save any pending changes first
    if (dirtyRows.size > 0) {
      await handleSavePage();
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/precios/importaciones/${importacionId}/matching/confirmar`, {
        method: 'POST'
      });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error);
      
      toast.success(`Consolidación exitosa. ${d.consolidados} precios aplicados.`);
      router.push('/precios/importaciones');
    } catch (e: any) {
      toast.error(e.message);
      setSaving(false);
    }
  };

  const selectAllInPage = (confirm: boolean) => {
    setData(prev => {
      const newData = [...prev];
      newData.forEach(r => {
        if (r.articulo_id_final) {
            r.confirmado = confirm;
            setDirtyRows(curr => new Set(curr).add(r.id));
        }
      });
      return newData;
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col h-[800px]">
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Revisión de Matching</h2>
          <p className="text-sm text-slate-500">Selecciona o corrige los artículos antes de consolidar.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onBack} className="px-4 py-2 border border-slate-300 rounded-xl text-slate-700 hover:bg-slate-100 font-semibold text-sm transition-colors">Volver</button>
          <button onClick={handleConfirmAll} disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 font-semibold text-sm transition-colors flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <CheckCircle2 className="w-4 h-4"/>}
            Consolidar e Importar
          </button>
        </div>
      </div>

      <div className="p-4 border-b border-slate-200 flex flex-wrap gap-4 items-center bg-white justify-between">
        <div className="flex gap-2">
          {[1, 2, 3].map(n => (
            <button
              key={n}
              onClick={() => { setNivelFilter(n); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${nivelFilter === n ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              Nivel {n} {n === 1 ? '(100%)' : n === 2 ? '(80%)' : '(0%)'}
            </button>
          ))}
        </div>

        <div className="flex gap-3 items-center">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Buscar modelo o marca..." 
              className="pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm w-64 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchData()}
            />
          </div>
          
          <button onClick={handleSavePage} disabled={dirtyRows.size === 0 || saving} className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
            Guardar Cambios
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-slate-50 relative">
        {loading && <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-indigo-500"/></div>}
        
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 border-b border-slate-200 text-slate-600 font-semibold sticky top-0 z-20">
            <tr>
              <th className="px-4 py-3 w-10 text-center">
                 <input type="checkbox" onChange={(e) => selectAllInPage(e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
              </th>
              <th className="px-4 py-3">Datos del Excel (Crudo)</th>
              <th className="px-4 py-3">Match Sugerido ({nivelFilter === 1 ? '100%' : '80%'})</th>
              <th className="px-4 py-3 w-64">ID Artículo Catálogo (Manual)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {data.length === 0 && !loading && (
              <tr><td colSpan={4} className="py-20 text-center text-slate-500">No hay filas en esta categoría.</td></tr>
            )}
            {data.map(row => (
              <tr key={row.id} className={`hover:bg-slate-50 transition-colors ${row.confirmado ? 'bg-indigo-50/30' : ''}`}>
                <td className="px-4 py-3 text-center">
                  <input 
                    type="checkbox" 
                    checked={row.confirmado} 
                    onChange={(e) => updateRow(row.id, { confirmado: e.target.checked })}
                    disabled={!row.articulo_id_final}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer disabled:opacity-50"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-800">{row.modelo_excel || '-'}</div>
                  <div className="text-xs text-slate-500">{row.marca_excel || '-'} | {row.codigo_universal_excel || '-'}</div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate max-w-xs" title={row.nombre_excel || ''}>{row.nombre_excel}</div>
                </td>
                <td className="px-4 py-3">
                  {row.cand_articulo_id ? (
                     <div>
                       <div className="font-semibold text-indigo-700 flex items-center gap-1.5">
                         {row.cand_modelo || '-'}
                         <span className="bg-indigo-100 text-indigo-800 text-[10px] px-1.5 py-0.5 rounded font-bold">{row.pct}%</span>
                       </div>
                       <div className="text-xs text-slate-500">{row.cand_marca || '-'}</div>
                     </div>
                  ) : (
                     <div className="text-xs text-amber-600 flex items-center gap-1 bg-amber-50 p-1.5 rounded w-fit"><AlertTriangle className="w-3.5 h-3.5"/> Sin sugerencia</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <input 
                    type="text" 
                    value={row.articulo_id_final || ''} 
                    onChange={(e) => {
                      const val = e.target.value.trim() || null;
                      updateRow(row.id, { articulo_id_final: val, confirmado: !!val });
                    }}
                    placeholder="Pega el ID aquí..."
                    className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                  {row.articulo_id_final && !row.cand_articulo_id && (
                     <div className="text-[10px] text-emerald-600 mt-1 font-medium">✔ Asignado manual</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-3 border-t border-slate-200 bg-white flex justify-between items-center text-sm">
        <div className="text-slate-500">Página {page} de {totalPages}</div>
        <div className="flex gap-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4"/></button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-50"><ChevronRight className="w-4 h-4"/></button>
        </div>
      </div>
    </div>
  );
}
