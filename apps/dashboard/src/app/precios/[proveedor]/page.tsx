import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, Settings, History, Download, RefreshCw, Search } from 'lucide-react';
import { HubTableActions } from '@/components/precios/flow/HubTableActions';

export default async function HubProveedorPage(props: { params: Promise<{ proveedor: string }>, searchParams: Promise<any> }) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const supa = supabaseAdmin;

    // Get count
    const { count } = await supa.from('v_lista_precios_proveedor').select('*', { count: 'exact', head: true }).eq('proveedor', proveedorDecoded);

    // Get latest batch
    const { data: historial } = await supa.from('v_importaciones_historial')
        .select('*').eq('proveedor', proveedorDecoded).order('creado_el', { ascending: false }).limit(1);
    
    const latestBatch = historial?.[0];
    let loteNum = 1;
    if (latestBatch) {
        const { count: c } = await supa.from('v_importaciones_historial').select('*', { count: 'exact', head: true }).eq('proveedor', proveedorDecoded).lte('creado_el', latestBatch.creado_el);
        loteNum = c || 1;
    }

    // Get Active List
    let query = supa.from('v_lista_precios_proveedor').select('*').eq('proveedor', proveedorDecoded).order('ultima_actualizacion', { ascending: false });
    if (searchParams.q) {
        query = query.or(`nombre.ilike.%${searchParams.q}%,codigo_universal.ilike.%${searchParams.q}%,marca.ilike.%${searchParams.q}%,modelo.ilike.%${searchParams.q}%`);
    }

    const { data: listado, error } = await query;
    const fmtMx = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

    return (
        <div className="flex flex-col h-full bg-white relative">
            <header className="flex items-center justify-between px-8 py-6 border-b border-slate-200">
                <div className="flex flex-col">
                    <div className="flex items-center justify-between w-full mb-1">
                        <div className="flex items-center text-sm text-slate-500">
                            <Link href="/precios" className="hover:text-indigo-600 transition flex items-center">
                                <ArrowLeft className="w-3 h-3 mr-1" /> Precios
                            </Link>
                            <span className="mx-2">/</span>
                            <span className="font-medium text-slate-700">{proveedorDecoded}</span>
                        </div>
                        <div className="flex items-center space-x-3 text-sm text-slate-500">
                            <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/reglas`} className="hover:text-indigo-600 flex items-center">
                                <Settings className="w-4 h-4 mr-1" /> Reglas
                            </Link>
                            <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/historico`} className="hover:text-indigo-600 flex items-center">
                                <History className="w-4 h-4 mr-1" /> Histórico
                            </Link>
                        </div>
                    </div>
                    <div className="flex justify-between items-end mt-2">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{proveedorDecoded}</h1>
                            <p className="text-sm text-slate-500 mt-1">
                                {count || 0} SKUs · Última act. {latestBatch ? new Date(latestBatch.creado_el).toLocaleDateString() : 'Nunca'} · Lote activo: {latestBatch ? `Lote #${loteNum}` : 'Ninguno'}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center">
                    <Link
                        href={`/precios/${encodeURIComponent(proveedorDecoded)}/subir`}
                        className="bg-indigo-600 text-white px-6 py-3 rounded-lg font-medium shadow-sm hover:bg-indigo-700 transition-colors flex items-center text-lg"
                    >
                        <span className="mr-2 text-xl">+</span> Actualizar lista de precios
                    </Link>
                </div>
            </header>

            <div className="flex-1 overflow-hidden flex flex-col bg-slate-50">
                <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
                    <form action={`/precios/${encodeURIComponent(proveedorDecoded)}`} method="GET" className="relative w-80">
                        <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                        <input 
                            type="text" 
                            name="q" 
                            placeholder="Buscar EAN, modelo o nombre..." 
                            defaultValue={searchParams.q || ''}
                            className="pl-9 pr-4 py-2 w-full text-sm border border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500" 
                        />
                    </form>
                    <HubTableActions proveedor={proveedorDecoded} count={count || 0} />
                </div>
                
                <div className="flex-1 overflow-auto">
                    {error ? (
                        <div className="p-8 text-red-600">Error: {error.message}</div>
                    ) : (listado && listado.length > 0) ? (
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50 sticky top-0 shadow-sm z-10">
                                <tr>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">Cód. Universal</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">Marca / Modelo</th>
                                    <th className="px-4 py-3 text-right font-medium text-slate-500 uppercase text-xs">Costo Dist.</th>
                                    <th className="px-4 py-3 text-right font-medium text-slate-500 uppercase text-xs">Costo Sub.</th>
                                    <th className="px-4 py-3 text-right font-medium text-slate-500 uppercase text-xs">Mayoreo</th>
                                    <th className="px-4 py-3 text-right font-medium text-slate-500 uppercase text-xs">Menudeo</th>
                                    <th className="px-4 py-3 text-center font-medium text-slate-500 uppercase text-xs">IVA</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">Últ. Act.</th>
                                    <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase text-xs">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-200">
                                {listado.map((item: any) => (
                                    <tr key={item.articulo_id} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-4 py-3 text-slate-500 font-mono">{item.codigo_universal || '-'}</td>
                                        <td className="px-4 py-3 font-medium text-slate-900">{item.marca} {item.modelo}</td>
                                        <td className="px-4 py-3 text-right text-emerald-600 font-medium">{item.costo_distribuidor ? fmtMx.format(item.costo_distribuidor) : '-'}</td>
                                        <td className="px-4 py-3 text-right text-slate-700">{item.costo_subdistribuidor ? fmtMx.format(item.costo_subdistribuidor) : '-'}</td>
                                        <td className="px-4 py-3 text-right text-slate-700">{item.precio_mayoreo ? fmtMx.format(item.precio_mayoreo) : '-'}</td>
                                        <td className="px-4 py-3 text-right text-slate-700">{item.precio_menudeo ? fmtMx.format(item.precio_menudeo) : '-'}</td>
                                        <td className="px-4 py-3 text-center">
                                            {item.algun_precio_con_iva ? (
                                                <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded font-medium">Con IVA</span>
                                            ) : (
                                                <span className="bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded font-medium">Sin IVA</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 text-xs">{item.ultima_actualizacion ? new Date(item.ultima_actualizacion).toLocaleDateString() : '-'}</td>
                                        <td className="px-4 py-3 text-center">
                                            <button className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="Recalcular precio de publicación">
                                                <RefreshCw className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="p-12 text-center text-slate-500">
                            No hay artículos vigentes en el listado principal.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
