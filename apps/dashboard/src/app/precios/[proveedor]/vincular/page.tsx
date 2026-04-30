import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { PendienteVincularRow } from '@/components/precios/PendienteVincularRow';
import { AlertCircle, ArrowRight, Forward } from 'lucide-react';

export default async function VincularPaso2(props: { params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    const { data: rawPendientes, error } = await supabaseAdmin
        .from('costos_pendientes')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .eq('resuelto', false)
        .order('creado_el', { ascending: false });

    // Group to avoid showing 4x duplicates for different tipo_costo
    const pendientesMap = new Map();
    if (rawPendientes) {
        rawPendientes.forEach(p => {
            const key = `${p.codigo_excel}-${p.marca_excel}-${p.modelo_excel}`;
            if (!pendientesMap.has(key)) {
                pendientesMap.set(key, p);
            }
        });
    }
    const pendientes = Array.from(pendientesMap.values());
    const hasPendientes = pendientes.length > 0;

    return (
        <div className="flex flex-col h-full bg-slate-50 relative">
            <div className="flex-1 overflow-auto p-8 max-w-7xl mx-auto w-full pb-32">
                <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900">Vincular Artículos</h2>
                    <p className="text-slate-500 mt-1">Estos productos no pudieron emparejarse automáticamente con tu catálogo de Mercado Libre.</p>
                </div>

                {error ? (
                    <div className="text-red-600 bg-red-50 p-4 rounded-md">Error: {error.message}</div>
                ) : !hasPendientes ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-500 bg-white border border-slate-200 rounded-xl">
                        <div className="bg-emerald-100 p-4 rounded-full mb-4">
                            <AlertCircle className="w-8 h-8 text-emerald-600" />
                        </div>
                        <h3 className="text-lg font-medium text-slate-900">¡Todo está vinculado!</h3>
                        <p>No hay artículos pendientes de vinculación para este proveedor.</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50 text-slate-500 font-medium">
                                <tr>
                                    <th className="px-4 py-3 text-left">SKU Excel</th>
                                    <th className="px-4 py-3 text-left">Marca / Modelo</th>
                                    <th className="px-4 py-3 text-left">Costo Lista</th>
                                    <th className="px-4 py-3 text-left">Buscar catálogo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 bg-white">
                                {pendientes.map((p: any) => (
                                    <PendienteVincularRow key={p.id} pendiente={p} />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Footer Fijo */}
            <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-200 p-4 flex justify-between items-center shadow-lg">
                <div className="text-sm text-slate-500 pl-4">
                    {hasPendientes ? `Mostrando ${pendientes.length} artículos por vincular.` : 'Listo para avanzar.'}
                </div>
                <div className="flex items-center space-x-4 pr-4">
                    <Link 
                        href={`/precios/${encodeURIComponent(proveedorDecoded)}/comparar`}
                        className="inline-flex items-center px-4 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-md font-medium transition-colors"
                    >
                        Saltar y continuar
                    </Link>
                    <Link 
                        href={`/precios/${encodeURIComponent(proveedorDecoded)}/comparar`}
                        className={`inline-flex items-center px-6 py-2.5 rounded-lg font-medium shadow-sm transition-colors
                            ${hasPendientes 
                                ? 'bg-indigo-200 text-white pointer-events-none' // Deshabilitado visualmente (aunque podrían usar Saltar)
                                : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                    >
                        Continuar a comparación <ArrowRight className="w-4 h-4 ml-2" />
                    </Link>
                </div>
            </div>
        </div>
    );
}
