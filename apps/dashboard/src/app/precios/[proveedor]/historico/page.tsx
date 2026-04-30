import { supabaseAdmin } from '@/lib/supabase';
import { LoteActions } from '@/components/precios/LoteActions';

export default async function HistoricoPage(props: { params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    const { data: historial, error } = await supabaseAdmin
        .from('v_importaciones_historial')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .order('creado_el', { ascending: false });

    return (
        <div className="flex flex-col h-full bg-slate-50 relative p-8 max-w-7xl mx-auto">
            <div className="mb-6">
                <h2 className="text-2xl font-bold text-slate-900">Histórico de Importaciones</h2>
                <p className="text-slate-500 mt-1">Consulta los lotes pasados o restaura un lote anterior en caso de emergencia.</p>
            </div>

            <div className="flex-1 overflow-auto bg-white border border-slate-200 rounded-xl shadow-sm">
                {error ? (
                    <div className="p-8 text-red-600">Error: {error.message}</div>
                ) : !historial || historial.length === 0 ? (
                    <div className="p-12 text-center text-slate-500">No hay historial para este proveedor.</div>
                ) : (
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                            <tr>
                                <th className="px-6 py-4 text-left font-medium text-slate-500 uppercase text-xs">Lote ID</th>
                                <th className="px-6 py-4 text-left font-medium text-slate-500 uppercase text-xs">Fecha</th>
                                <th className="px-6 py-4 text-left font-medium text-slate-500 uppercase text-xs">Estado</th>
                                <th className="px-6 py-4 text-left font-medium text-slate-500 uppercase text-xs">Vigente</th>
                                <th className="px-6 py-4 text-right font-medium text-slate-500 uppercase text-xs">Acción</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-slate-200">
                            {historial.map(h => (
                                <tr key={h.id} className={h.vigente ? 'bg-indigo-50/30' : ''}>
                                    <td className="px-6 py-4 font-mono text-slate-500">{h.id.substring(0,8)}</td>
                                    <td className="px-6 py-4 text-slate-900 font-medium">{new Date(h.creado_el).toLocaleString()}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${h.estado === 'completado' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'}`}>
                                            {h.estado}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        {h.vigente ? (
                                            <span className="bg-indigo-100 text-indigo-800 px-2.5 py-1 rounded-full text-xs font-medium">Lote Activo</span>
                                        ) : (
                                            <span className="text-slate-400">Inactivo</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <LoteActions importacion={h} proveedor={proveedorDecoded} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
