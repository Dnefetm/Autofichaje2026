import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, Clock, History, FileDown, Search, AlertTriangle } from 'lucide-react';

export default async function DetalleProveedorPage(props: { params: Promise<{ proveedor: string }>, searchParams: Promise<any> }) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const supa = supabaseAdmin;

    // Query con búsqueda simple server-side si viene el parámetro 'q'
    let query = supa.from('v_lista_precios_proveedor').select('*').eq('proveedor', proveedorDecoded).order('ultima_actualizacion', { ascending: false });
    if (searchParams.q) {
        query = query.or(`nombre.ilike.%${searchParams.q}%,codigo_universal.ilike.%${searchParams.q}%,marca.ilike.%${searchParams.q}%,modelo.ilike.%${searchParams.q}%`);
    }

    const { data: listado, error } = await query;

    function isRma(caja: string | null) {
        if (!caja) return false;
        const low = caja.toLowerCase();
        return low.includes('devolución') || low.includes('devolucion') || low.includes('rma') || low.includes('devuelto');
    }

    // Utilidades monetarias
    const fmtMx = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

    return (
        <div className="flex flex-col h-[calc(100vh-80px)]">
            {/* Header ToolBar */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
                <div className="flex flex-col">
                    <div className="flex items-center text-sm text-slate-500 mb-1">
                        <Link href="/precios" className="hover:text-indigo-600 transition flex items-center">
                            <ArrowLeft className="w-3 h-3 mr-1" /> Precios
                        </Link>
                        <span className="mx-2">/</span>
                        <span className="font-medium text-slate-700">{proveedorDecoded}</span>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{proveedorDecoded}</h1>
                </div>
                <div className="flex items-center gap-3">
                    <Link
                        href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial`}
                        className="btn-outline-indigo"
                    >
                        <History className="w-4 h-4 mr-2" /> Histórico
                    </Link>
                    <Link
                        href={`/precios/importar?proveedor=${encodeURIComponent(proveedorDecoded)}`}
                        className="btn-primary"
                    >
                        <Clock className="w-4 h-4 mr-2" /> Actualizar desde Excel
                    </Link>
                </div>
            </header>

            {/* Controles de Tabla */}
            <div className="p-4 bg-slate-50 border-b border-slate-200 shrink-0 flex items-center justify-between">
                {/* Form nativo simple para búsqueda Server-Side */}
                <form action={`/precios/${encodeURIComponent(proveedorDecoded)}`} method="GET" className="relative w-72">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input 
                        type="text" 
                        name="q" 
                        placeholder="Buscar EAN, modelo o nombre..." 
                        defaultValue={searchParams.q || ''}
                        className="pl-9 pr-4 py-2 w-full text-sm border border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500" 
                    />
                </form>
                
                <button className="text-sm text-slate-600 hover:text-slate-900 font-medium flex items-center">
                    <FileDown className="w-4 h-4 mr-1" />
                    Exportar Lista Activa
                </button>
            </div>

            {/* Tabla Densa Scrollable */}
            <div className="flex-1 overflow-auto bg-white relative">
                {error ? (
                    <div className="p-6 text-red-600">Error cargando el listado: {error.message}</div>
                ) : !listado || listado.length === 0 ? (
                    <div className="p-12 text-center text-slate-500">
                        {searchParams.q ? 'No hay resultados para la búsqueda.' : 'Este proveedor no tiene SKUs vigentes o nunca se ha importado.'}
                    </div>
                ) : (
                    <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-slate-100 text-slate-600 sticky top-0 z-20 font-medium whitespace-nowrap shadow-sm">
                            <tr>
                                <th className="px-4 py-3 sticky left-0 z-30 bg-slate-100 border-b border-r border-slate-200">Cód. Universal</th>
                                <th className="px-4 py-3 border-b border-slate-200">Marca / Modelo</th>
                                <th className="px-4 py-3 border-b border-slate-200 min-w-[200px]">Nombre y Ubicación</th>
                                <th className="px-4 py-3 border-b border-slate-200 text-right">Costo Dist.</th>
                                <th className="px-4 py-3 border-b border-slate-200 text-right">Costo Sub.</th>
                                <th className="px-4 py-3 border-b border-slate-200 text-right">Mayoreo</th>
                                <th className="px-4 py-3 border-b border-slate-200 text-right">Menudeo</th>
                                <th className="px-4 py-3 border-b border-slate-200 text-center">IVA</th>
                                <th className="px-4 py-3 border-b border-slate-200">Últ. Actualización</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {listado.map(row => (
                                <tr key={row.articulo_id || row.id || Math.random()} className={`hover:bg-slate-50 transition-colors group ${row.huerfano ? 'bg-amber-50' : ''}`}>
                                    <td className={`px-4 py-2 font-mono text-xs text-slate-600 sticky left-0 z-10 ${row.huerfano ? 'bg-amber-50' : 'bg-white'} group-hover:bg-slate-50 border-r border-slate-100`}>
                                        {row.codigo_universal || '—'}
                                    </td>
                                    <td className="px-4 py-2 whitespace-nowrap">
                                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                                            {row.huerfano && <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" title="Sin match en catálogo maestro — resolver antes de operar" />}
                                            {row.marca}
                                        </div>
                                        <div className="text-slate-500 text-xs ml-[22px]">{row.modelo}</div>
                                    </td>
                                    <td className="px-4 py-2">
                                        <div className="text-slate-800 line-clamp-2 leading-tight mb-1" title={row.nombre}>{row.nombre}</div>
                                        {row.caja_madre && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-medium ${isRma(row.caja_madre) ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                                                Ubic: {row.caja_madre}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2 text-right font-medium text-slate-700">
                                        {row.costo_distribuidor ? fmtMx.format(row.costo_distribuidor) : '—'}
                                    </td>
                                    <td className="px-4 py-2 text-right text-slate-600">
                                        {row.costo_subdistribuidor ? fmtMx.format(row.costo_subdistribuidor) : '—'}
                                    </td>
                                    <td className="px-4 py-2 text-right text-slate-600">
                                        {row.precio_mayoreo ? fmtMx.format(row.precio_mayoreo) : '—'}
                                    </td>
                                    <td className="px-4 py-2 text-right text-slate-600">
                                        {row.precio_menudeo ? fmtMx.format(row.precio_menudeo) : '—'}
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                        {row.todos_precios_con_iva ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800">Con IVA</span>
                                        ) : row.algun_precio_con_iva ? (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800" title="Algunos precios con IVA y otros sin IVA">Mixto</span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600">Sin IVA</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2 text-xs text-slate-500">
                                        {row.ultima_actualizacion ? new Date(row.ultima_actualizacion).toLocaleString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            {/* Custom CSS overrides para los botones agregados sin tailwind classes */}
            <style dangerouslySetInnerHTML={{__html: `
                .btn-primary { @apply inline-flex items-center px-4 py-2 bg-indigo-600 border border-transparent rounded-md font-medium text-white hover:bg-indigo-700 shadow-sm text-sm transition-colors; }
                .btn-outline-indigo { @apply inline-flex items-center px-4 py-2 bg-white border border-indigo-200 rounded-md font-medium text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 shadow-sm text-sm transition-colors; }
            `}} />
        </div>
    );
}
