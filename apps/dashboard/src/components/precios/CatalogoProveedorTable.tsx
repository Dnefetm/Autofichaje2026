'use client';

import { useState } from 'react';
import { Link as LinkIcon, Check, Plus } from 'lucide-react';
import { VincularArticuloModal } from './VincularArticuloModal';

export function CatalogoProveedorTable({
    proveedor,
    items = []
}: {
    proveedor: string;
    items: any[];
}) {
    const [selectedItem, setSelectedItem] = useState<any | null>(null);
    const fmtMx = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                            <th className="py-3.5 px-4 min-w-[200px]">Código / Modelo</th>
                            <th className="py-3.5 px-4 min-w-[260px]">Descripción</th>
                            <th className="py-3.5 px-4 text-right">Distribuidor</th>
                            <th className="py-3.5 px-4 text-right">Subdistribuidor</th>
                            <th className="py-3.5 px-4 text-right">Mayoreo</th>
                            <th className="py-3.5 px-4 text-right">Menudeo</th>
                            <th className="py-3.5 px-4 text-center">Estado Catálogo</th>
                            <th className="py-3.5 px-4 text-right">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                        {items.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                                    No hay productos para mostrar en este catálogo.
                                </td>
                            </tr>
                        ) : (
                            items.map(item => {
                                const vinculado = !!item.articulo_id_vinculado;
                                return (
                                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors group">
                                        {/* Código y Modelo */}
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

                                        {/* Descripción */}
                                        <td className="py-3.5 px-4 align-top text-slate-600">
                                            <p className="line-clamp-2" title={item.descripcion}>
                                                {item.descripcion || '—'}
                                            </p>
                                        </td>

                                        {/* 4 Precios por Producto */}
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

                                        {/* Estado de Vinculación */}
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

                                        {/* Botón de Acción */}
                                        <td className="py-3.5 px-4 text-right align-top">
                                            <button
                                                onClick={() => setSelectedItem(item)}
                                                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1 shadow-sm ${vinculado ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
                                            >
                                                {vinculado ? (
                                                    <>
                                                        <LinkIcon className="w-3 h-3" /> Cambiar
                                                    </>
                                                ) : (
                                                    <>
                                                        <Plus className="w-3 h-3" /> Vincular
                                                    </>
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

            {/* Modal de Vinculación */}
            {selectedItem && (
                <VincularArticuloModal
                    proveedor={proveedor}
                    itemProveedor={selectedItem}
                    onClose={() => setSelectedItem(null)}
                    onSuccess={() => {
                        window.location.reload();
                    }}
                />
            )}
        </div>
    );
}
