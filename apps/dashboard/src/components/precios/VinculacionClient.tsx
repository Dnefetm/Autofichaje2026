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
    catTriple,
    catSoloCodigo,
    catMarcaModelo,
    yaVinculados,
    sinMatch
}: Props) {
    const [tab, setTab] = useState<'propuestas' | 'vinculados' | 'sin_match'>('propuestas');
    const [page, setPage] = useState(0);
    const pageSize = 100;

    const totalPropuestas = catTriple.length + catSoloCodigo.length + catMarcaModelo.length;

    // Paginación solo para sin match y vinculados
    const paginatedSinMatch = sinMatch.slice(page * pageSize, page * pageSize + pageSize);
    const paginatedVinculados = yaVinculados.slice(page * pageSize, page * pageSize + pageSize);

    const fmtMx = (n: number) => n > 0 ? n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : '—';

    return (
        <div>
            {/* Tabs */}
            <div className="bg-white border-b border-slate-200 px-8 flex gap-1 py-2">
                <button
                    onClick={() => { setTab('propuestas'); setPage(0); }}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === 'propuestas' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                    Propuestas ({totalPropuestas.toLocaleString()})
                </button>
                <button
                    onClick={() => { setTab('vinculados'); setPage(0); }}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === 'vinculados' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                    Ya Vinculados ({yaVinculados.length.toLocaleString()})
                </button>
                <button
                    onClick={() => { setTab('sin_match'); setPage(0); }}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === 'sin_match' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                    Sin Coincidencia ({sinMatch.length.toLocaleString()})
                </button>
            </div>

            <div className="px-8 py-6">
                {/* Tab: Propuestas */}
                {tab === 'propuestas' && (
                    <>
                        {catTriple.length > 0 && (
                            <VinculacionCategoria categoria="triple" titulo="Código de Barras + Marca + Modelo coinciden" descripcion="El EAN/código universal, la marca y el modelo son idénticos en ambos lados. Confianza máxima." color="emerald" items={catTriple} proveedor={proveedor} />
                        )}
                        {catSoloCodigo.length > 0 && (
                            <VinculacionCategoria categoria="solo_codigo" titulo="Solo Código de Barras coincide" descripcion="El EAN/código universal coincide pero la marca o el modelo difieren. Revisa antes de aceptar." color="amber" items={catSoloCodigo} proveedor={proveedor} />
                        )}
                        {catMarcaModelo.length > 0 && (
                            <VinculacionCategoria categoria="marca_modelo" titulo="Solo Marca + Modelo coinciden (sin código de barras)" descripcion="No hay código de barras en el Excel para comparar. La coincidencia es solo por clave/modelo. Verifica." color="blue" items={catMarcaModelo} proveedor={proveedor} />
                        )}
                        {totalPropuestas === 0 && (
                            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
                                No hay propuestas de vinculación pendientes para este lote.
                            </div>
                        )}
                    </>
                )}

                {/* Tab: Ya Vinculados */}
                {tab === 'vinculados' && (
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-emerald-800">Artículos ya vinculados</h3>
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
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        <div className="px-6 py-4 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <FileX className="text-slate-400 w-5 h-5" />
                                <div>
                                    <h3 className="font-bold text-slate-800">Artículos sin coincidencia ({sinMatch.length.toLocaleString()})</h3>
                                    <p className="text-xs text-slate-500 mt-0.5">No se encontró código de barras ni modelo en tu catálogo.</p>
                                </div>
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
