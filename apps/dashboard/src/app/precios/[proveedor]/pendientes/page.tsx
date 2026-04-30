import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { PendienteVincularRow } from '@/components/precios/PendienteVincularRow';

export default async function PendientesPage(props: { params: Promise<{ proveedor: string }>, searchParams: Promise<any> }) {
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
            } else {
                // If we want to show multiple costs, we could aggregate here.
                // For UI simplicity, we just take the first one since vincular 1 resolves ALL.
            }
        });
    }
    const pendientes = Array.from(pendientesMap.values());

    return (
        <div className="flex flex-col h-[calc(100vh-80px)]">
            <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
                <div className="flex flex-col">
                    <div className="flex items-center text-sm text-slate-500 mb-1">
                        <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}`} className="hover:text-indigo-600 transition flex items-center">
                            <ArrowLeft className="w-3 h-3 mr-1" /> {proveedorDecoded}
                        </Link>
                        <span className="mx-2">/</span>
                        <span className="font-medium text-slate-700">Costos Pendientes de Vinculación</span>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Artículos Huérfanos</h1>
                </div>
            </header>
            <div className="flex-1 overflow-auto bg-slate-50 p-6">
                {error ? (
                    <div className="text-red-600">Error: {error.message}</div>
                ) : !pendientes || pendientes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        <div className="bg-green-100 p-4 rounded-full mb-4">
                            <AlertCircle className="w-8 h-8 text-green-600" />
                        </div>
                        <h3 className="text-lg font-medium text-slate-900">¡Todo está vinculado!</h3>
                        <p>No hay artículos pendientes de vinculación para este proveedor.</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
                        <table className="min-w-full divide-y divide-slate-200 text-sm">
                            <thead className="bg-slate-50 text-slate-500 font-medium">
                                <tr>
                                    <th className="px-4 py-3 text-left">Código Excel</th>
                                    <th className="px-4 py-3 text-left">Marca / Modelo</th>
                                    <th className="px-4 py-3 text-left">Costo / Moneda</th>
                                    <th className="px-4 py-3 text-left">Motivo</th>
                                    <th className="px-4 py-3 text-left">Vincular con Catálogo</th>
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
        </div>
    );
}
