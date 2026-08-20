'use client';
import { useState } from 'react';
import { VinculacionCategoria } from './VinculacionCategoria';
import { AlertCircle, FileX } from 'lucide-react';

interface MatchItem {
    fila_num: number;
    sku_proveedor: string;
    codigo_barra: string;
    marca_proveedor: string;
    descripcion_proveedor: string;
    dist: number;
    menudeo: number;
    articulo_id: string;
    nombre_catalogo: string;
    marca_catalogo: string;
    modelo_catalogo: string;
    codigo_universal: string;
}

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

    const fmtMx = (n: number) => n > 0 ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—';

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
                        className={`pb-4 pt-2 text-sm font-bold border-b-2 transition-colors ${tab === 'sin_match' ? 'border-slate-800 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        Sin Coincidencia ({sinMatch.length.toLocaleString()})
                    </button>
                </div>
            </div>

            <div className="p-8 max-w-[1600px] mx-auto w-full">
                {/* Tab: Propuestas */}
                {tab === 'propuestas' && (
                    <div className="flex flex-col gap-6">
                        {totalPropuestas === 0 ? (
                            <div className="bg-white p-12 text-center rounded-xl border border-slate-200 text-slate-400">
                                ¡Todo revisado! No quedan artículos pendientes de vincular en este lote.
                            </div>
                        ) : (
                            <>
                                <VinculacionCategoria 
                                    categoria="triple" 
                                    titulo="Coincidencia Exacta (Triple)" 
                                    descripcion="Marca, Modelo y Código de Barras coinciden exactamente." 
                                    color="emerald" 
                                    items={catTriple} 
                                    proveedor={proveedor}
                                    onAccepted={(items) => handleVinculados(items, 'triple')}
                                />
                                <VinculacionCategoria 
                                    categoria="solo_codigo" 
                                    titulo="Solo Código de Barras coincide" 
                                    descripcion="El EAN coincide pero la marca o modelo del Excel difieren ligeramente." 
                                    color="amber" 
                                    items={catSoloCodigo} 
                                    proveedor={proveedor}
                                    onAccepted={(items) => handleVinculados(items, 'solo_codigo')}
                                />
                                <VinculacionCategoria 
                                    categoria="marca_modelo" 
                                    titulo="Solo Marca + Modelo coinciden" 
                                    descripcion="No hay código de barras en el Excel para comparar." 
                                    color="blue" 
                                    items={catMarcaModelo} 
                                    proveedor={proveedor}
                                    onAccepted={(items) => handleVinculados(items, 'marca_modelo')}
                                />
                            </>
                        )}
                    </div>
                )}

                {/* Tab: Ya Vinculados */}
                {tab === 'vinculados' && (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="px-6 py-4 bg-emerald-50/50 border-b border-emerald-100 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-emerald-900 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-emerald-600" />
                                    Artículos ya vinculados ({yaVinculados.length.toLocaleString()})
                                </h3>
                                <p className="text-xs text-emerald-600 mt-0.5">Fueron confirmados en sesiones anteriores.</p>
                            </div>
                        </div>
                        {yaVinculados.length === 0 ? (
                            <div className="p-8 text-center text-slate-400">No hay artículos vinculados.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
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
                                <span className="text-xs text-slate-500">Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, yaVinculados.length)} de {yaVinculados.length}</span>
                                <div className="flex gap-2">
                                    <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1 bg-white border border-slate-200 rounded text-xs disabled:opacity-50">Anterior</button>
                                    <button disabled={(page + 1) * pageSize >= yaVinculados.length} onClick={() => setPage(p => p + 1)} className="px-3 py-1 bg-white border border-slate-200 rounded text-xs disabled:opacity-50">Siguiente</button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Tab: Sin Match */}
                {tab === 'sin_match' && (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                                    <FileX className="w-4 h-4 text-slate-400" />
                                    Artículos sin coincidencia ({sinMatch.length.toLocaleString()})
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">No se encontró código de barras ni modelo en tu catálogo.</p>
                            </div>
                        </div>
                        {sinMatch.length === 0 ? (
                            <div className="p-8 text-center text-slate-400">Todos los artículos tienen coincidencia.</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50">
                                        <tr className="text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-200">
                                            <th className="py-2.5 px-4 text-left">SKU Proveedor</th>
                                            <th className="py-2.5 px-4 text-left">Marca</th>
                                            <th className="py-2.5 px-4 text-left">Descripción</th>
                                            <th className="py-2.5 px-4 text-left">EAN Proveedor</th>
                                            <th className="py-2.5 px-4 text-right">Menudeo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {paginatedSinMatch.map(item => (
                                            <tr key={item.fila_num} className="hover:bg-slate-50/50">
                                                <td className="py-2.5 px-4 font-mono font-bold text-slate-700">{item.sku_proveedor}</td>
                                                <td className="py-2.5 px-4 text-slate-600">{item.marca_proveedor}</td>
                                                <td className="py-2.5 px-4 text-slate-800 line-clamp-1 max-w-[300px]">{item.descripcion_proveedor}</td>
                                                <td className="py-2.5 px-4 font-mono text-slate-500">{item.codigo_barra || '—'}</td>
                                                <td className="py-2.5 px-4 text-right font-semibold text-slate-800">{fmtMx(item.menudeo)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {sinMatch.length > pageSize && (
                            <div className="px-4 py-3 border-t border-slate-200 flex justify-between items-center bg-slate-50">
                                <span className="text-xs text-slate-500">Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sinMatch.length)} de {sinMatch.length}</span>
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