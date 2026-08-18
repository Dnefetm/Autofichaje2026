'use client';

import { useState } from 'react';
import { Link as LinkIcon, Check, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { VincularArticuloModal } from './VincularArticuloModal';

export function CatalogoProveedorTable({
    proveedor,
    items = []
}: {
    proveedor: string;
    items: any[];
}) {
    const [selectedItem, setSelectedItem] = useState<any | null>(null);
    const [localVinculados, setLocalVinculados] = useState<Set<string>>(new Set());
    const [page, setPage] = useState(0);
    const ITEMS_PER_PAGE = 50;

    const fmtMx = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const paginatedItems = items.slice(page * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE + ITEMS_PER_PAGE);

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Paginación Superior */}
            {totalPages > 1 && (
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-medium">
                        Mostrando {page * ITEMS_PER_PAGE + 1} - {Math.min((page + 1) * ITEMS_PER_PAGE, items.length)} de {items.length} artículos
                    </span>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="p-1.5 rounded bg-white border border-slate-200 text-slate-600 disabled:opacity-50 hover:bg-slate-50"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="text-xs font-bold text-slate-700 px-2">Pág {page + 1} de {totalPages}</span>
                        <button 
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={page === totalPages - 1}
                            className="p-1.5 rounded bg-white border border-slate-200 text-slate-600 disabled:opacity-50 hover:bg-slate-50"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            <th className="py-3.5 px-4 min-w-[200px]">Código / Modelo</th>
                            <th className="py-3.5 px-4 min-w-[260px]">Descripción</th>
                            <th className="py-3.5 px-4 text-right">Distribuidor</th>
                            <th className="py-3.5 px-4 text-right">Subdistr</th>
                            <th className="py-3.5 px-4 text-right">Mayoreo</th>
                            <th className="py-3.5 px-4 text-right">Menudeo</th>
                            <th className="py-3.5 px-4 text-center">Estado Catálogo</th>
                            <th className="py-3.5 px-4 text-right">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                        {paginatedItems.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                                    No hay productos para mostrar.
                                </td>
                            </tr>
                        ) : (
                            paginatedItems.map(item => {
                                const vinculado = !!item.articulo_id_vinculado || localVinculados.has(item.id);
                                return (
                                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors group">
                                        <td className="py-3.5 px-4 align-top">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                                                    {item.modelo || item.codigo}
                                                </span>
                                                <span className="text-slate-400 text-[10px]">{item.marca}</span>
                                            </div>
                                            {item.codigo && item.codigo !== item.modelo && (
                                                <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                                    EAN: {item.codigo}
                                                </div>
                                            )}
                                        </td>
                                        <td className="py-3.5 px-4 align-top text-slate-600">
                                            <p className="line-clamp-2" title={item.descripcion}>
                                                {item.descripcion || '—'}
                                            </p>
                                        </td>
                                        <td className="py-3.5 px-4 text-right align-top font-bold text-slate-900">
                                            {item.precio_distribuidor ? fmtMx.format(parseFloat(item.precio_distribuidor)) : '—'}
                                        </td>
                                        <td className="py-3.5 px-4 text-right align-top text-slate-700">
                                            {item.precio_subdistribuidor ? fmtMx.format(parseFloat(item.precio_subdistribuidor)) : '—'}
                                        </td>
                                        <td className="py-3.5 px-4 text-right align-top text-slate-700">
                                            {item.precio_mayoreo ? fmtMx.format(parseFloat(item.precio_mayoreo)) : '—'}
                                        </td>
                                        <td className="py-3.5 px-4 text-right align-top text-slate-700">
                                            {item.precio_menudeo ? fmtMx.format(parseFloat(item.precio_menudeo)) : '—'}
                                        </td>
                                        <td className="py-3.5 px-4 text-center align-top">
                                            {vinculado ? (
                                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                    <Check className="w-3 h-3" /> Vinculado
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">
                                                    No vinculado
                                                </span>
                                            )}
                                        </td>
                                        <td className="py-3.5 px-4 text-right align-top">
                                            <button
                                                onClick={() => setSelectedItem(item)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1 shadow-sm ${vinculado ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                                            >
                                                {vinculado ? (
                                                    <><LinkIcon className="w-3 h-3" /> Cambiar</>
                                                ) : (
                                                    <><Plus className="w-3 h-3" /> Vincular</>
                                                )}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Paginación Inferior */}
            {totalPages > 1 && (
                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                     <span className="text-xs text-slate-500 font-medium">
                        Página {page + 1} de {totalPages}
                    </span>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-3 py-1.5 rounded bg-white border border-slate-200 text-slate-600 disabled:opacity-50 font-bold text-xs">Anterior</button>
                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} className="px-3 py-1.5 rounded bg-white border border-slate-200 text-slate-600 disabled:opacity-50 font-bold text-xs">Siguiente</button>
                    </div>
                </div>
            )}

            {selectedItem && (
                <VincularArticuloModal
                    proveedor={proveedor}
                    itemProveedor={selectedItem}
                    onClose={() => setSelectedItem(null)}
                    onSuccess={() => {
                        setLocalVinculados(prev => new Set([...prev, selectedItem.id]));
                        setSelectedItem(null);
                    }}
                />
            )}
        </div>
    );
}
