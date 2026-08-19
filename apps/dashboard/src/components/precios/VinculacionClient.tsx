
'use client';
import { useState } from 'react';
import { VinculacionCategoria } from './VinculacionCategoria';
import { AlertCircle, FileX } from 'lucide-react';
import { MatchItem } from '@/types/precios';

const fmtMx = (num: any) => {
    if (typeof num !== 'number') return '—';
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
};

interface Props {
    proveedor: string;
    catTriple: MatchItem[];
    catSoloCodigo: MatchItem[];
    catMarcaModelo: MatchItem[];
    yaVinculados: MatchItem[];
    sinMatch: MatchItem[];
}

export function VinculacionClient({
    proveedor,
    catTriple: initCatTriple,
    catSoloCodigo: initCatSoloCodigo,
    catMarcaModelo: initCatMarcaModelo,
    yaVinculados: initYaVinculados,
    sinMatch
}: Props) {
    const [tab, setTab] = useState<'propuestas' | 'vinculados' | 'sin_match'>('propuestas');
    const [page, setPage] = useState(0);
    const pageSize = 100;

    const [catTriple, setCatTriple] = useState(initCatTriple);
    const [catSoloCodigo, setCatSoloCodigo] = useState(initCatSoloCodigo);
    const [catMarcaModelo, setCatMarcaModelo] = useState(initCatMarcaModelo);
    const [yaVinculados, setYaVinculados] = useState(initYaVinculados);

    const totalPropuestas = catTriple.length + catSoloCodigo.length + catMarcaModelo.length;

    const handleVinculados = (items: MatchItem[], category: string) => {
        const itemIds = new Set(items.map(i => i.fila_num));
        setYaVinculados(prev => [...prev, ...items]);
        if (category === 'triple') setCatTriple(prev => prev.filter(i => !itemIds.has(i.fila_num)));
        if (category === 'solo_codigo') setCatSoloCodigo(prev => prev.filter(i => !itemIds.has(i.fila_num)));
        if (category === 'marca_modelo') setCatMarcaModelo(prev => prev.filter(i => !itemIds.has(i.fila_num)));
    };

    const paginatedSinMatch = sinMatch.slice(page * pageSize, page * pageSize + pageSize);
    const paginatedVinculados = yaVinculados.slice(page * pageSize, page * pageSize + pageSize);

    return (
        <div className="flex flex-col flex-1">
            <div className="px-8 border-b border-slate-200 bg-white">
                <div className="flex gap-6 mt-2">
                    <button
                        onClick={() => { setTab('propuestas'); setPage(0); }}
                        className={`pb-4 pt-2 text-sm font-bold border-b-2 transition-colors ${tab === 'propuestas' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        Propuestas ({totalPropuestas.toLocaleString()})
                    </button>
                    <button
                        onClick={() => { setTab('vinculados'); setPage(0); }}
                        className={`pb-4 pt-2 text-sm font-bold border-b-2 transition-colors ${tab === 'vinculados' ? 'border-emerald-500 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        Ya Vinculados ({yaVinculados.length.toLocaleString()})
                    </button>
                    <button
                        onClick={() => { setTab('sin_match'); setPage(0); }}
                        className={`pb-4 pt-2 text-sm font-bold border-b-2 transition-colors ${tab === 'sin_match' ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        Sin Coincidencia ({sinMatch.length.toLocaleString()})
                    </button>
                </div>
            </div>

            <div className="flex-1 p-8">
                {tab === 'propuestas' && (
                    <div className="space-y-6">
                        {catTriple.length > 0 && (
                            <VinculacionCategoria categoria="triple" titulo="Código de Barras + Marca + Modelo coinciden" descripcion="El EAN/código universal, la marca y el modelo son idénticos en ambos lados." color="emerald" items={catTriple} proveedor={proveedor} onAccepted={(items) => handleVinculados(items, 'triple')} />
                        )}
                        {catSoloCodigo.length > 0 && (
                            <VinculacionCategoria categoria="solo_codigo" titulo="Solo Código de Barras coincide" descripcion="El EAN/código universal coincide pero la marca o el modelo difieren." color="amber" items={catSoloCodigo} proveedor={proveedor} onAccepted={(items) => handleVinculados(items, 'solo_codigo')} />
                        )}
                        {catMarcaModelo.length > 0 && (
                            <VinculacionCategoria categoria="marca_modelo" titulo="Solo Marca + Modelo coinciden" descripcion="No hay código de barras en el Excel para comparar." color="blue" items={catMarcaModelo} proveedor={proveedor} onAccepted={(items) => handleVinculados(items, 'marca_modelo')} />
                        )}
                        {totalPropuestas === 0 && (
                            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                                No hay propuestas de vinculación pendientes.
                            </div>
                        )}
                    </div>
                )}

                {tab === 'vinculados' && (
                    <div className="bg-white rounded-2xl border border-emerald-200 overflow-hidden shadow-sm">
                        <div className="px-6 py-4 bg-emerald-50/50 border-b border-emerald-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <AlertCircle className="text-emerald-500 w-5 h-5" />
                                <div>
                                    <h3 className="font-bold text-emerald-800">Artículos ya vinculados ({yaVinculados.length.toLocaleString()})</h3>
                                    <p className="text-xs text-emerald-600 mt-0.5">Confirmados.</p>
                                </div>
                            </div>
                        </div>
                        {yaVinculados.length === 0 ? (
                            <div className="p-8 text-center text-slate-400">No hay artículos vinculados.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50">
                                        <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                            <th className="py-2.5 px-4 text-left">SKU / Descripción Proveedor</th>
                                            <th className="py-2.5 px-4 text-left">EAN Proveedor</th>
                                            <th className="py-2.5 px-4 text-left">Artículo Interno Vinculado</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {paginatedVinculados.map(item => (
                                            <tr key={item.fila_num} className="hover:bg-slate-50/50">
                                                <td className="py-2.5 px-4">
                                                    <span className="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">{item.sku_proveedor}</span>
                                                    <p className="text-slate-500 mt-0.5 line-clamp-1">{item.descripcion_proveedor}</p>
                                                </td>
                                                <td className="py-2.5 px-4 font-mono text-slate-600">{item.codigo_barra || '—'}</td>
                                                <td className="py-2.5 px-4">
                                                    <p className="font-semibold text-emerald-700 line-clamp-1">{item.nombre_catalogo}</p>
                                                    <p className="text-slate-500 text-[10px]">Mod: {item.modelo_catalogo || '—'} · EAN: {item.codigo_universal || '—'}</p>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {yaVinculados.length > pageSize && (
                            <div className="px-4 py-3 border-t border-slate-200 flex justify-between items-center bg-slate-50">
                                <span className="text-xs text-slate-500">Página {page + 1}</span>
                                <div className="flex gap-2">
                                    <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1 bg-white border border-slate-200 rounded text-xs disabled:opacity-50">Anterior</button>
                                    <button disabled={(page + 1) * pageSize >= yaVinculados.length} onClick={() => setPage(p => p + 1)} className="px-3 py-1 bg-white border border-slate-200 rounded text-xs disabled:opacity-50">Siguiente</button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {tab === 'sin_match' && (
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="px-6 py-4 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <FileX className="text-slate-400 w-5 h-5" />
                                <div>
                                    <h3 className="font-bold text-slate-800">Artículos sin coincidencia ({sinMatch.length.toLocaleString()})</h3>
                                </div>
                            </div>
                        </div>
                        {sinMatch.length === 0 ? (
                            <div className="p-8 text-center text-slate-400">Todos tienen coincidencia.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50">
                                        <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                            <th className="py-2.5 px-4">SKU Proveedor</th>
                                            <th className="py-2.5 px-4">Marca</th>
                                            <th className="py-2.5 px-4">Descripción</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {paginatedSinMatch.map(item => (
                                            <tr key={item.fila_num} className="hover:bg-slate-50/50">
                                                <td className="py-2.5 px-4 font-mono font-bold text-slate-700">{item.sku_proveedor}</td>
                                                <td className="py-2.5 px-4 text-slate-600">{item.marca_proveedor}</td>
                                                <td className="py-2.5 px-4 text-slate-800 line-clamp-1">{item.descripcion_proveedor}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {sinMatch.length > pageSize && (
                            <div className="px-4 py-3 border-t border-slate-200 flex justify-between items-center bg-slate-50">
                                <span className="text-xs text-slate-500">Página {page + 1}</span>
                                <div className="flex gap-2">
                                    <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1 bg-white border border-slate-200 rounded text-xs disabled:opacity-50">Anterior</button>
                                    <button disabled={(page + 1) * pageSize >= sinMatch.length} onClick={() => setPage(p => p + 1)} className="px-3 py-1 bg-white border border-slate-200 rounded text-xs disabled:opacity-50">Siguiente</button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
