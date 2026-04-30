import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { CheckCircle, ArrowLeft, RefreshCw, Layers } from 'lucide-react';

export default async function AplicarPaso4(props: { params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    // Get latest import batch
    const { data: ultimas } = await supabaseAdmin
        .from('v_importaciones_historial')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .order('creado_el', { ascending: false })
        .limit(1);

    const latestBatch = ultimas?.[0];

    // Count applied changes
    const { count: confirmados } = await supabaseAdmin
        .from('costos_articulo')
        .select('*', { count: 'exact', head: true })
        .eq('importacion_id', latestBatch?.id)
        .not('confirmado_por', 'is', null);

    // Get queued items for UI
    const { count: encolados } = await supabaseAdmin
        .from('precio_recalc_queue')
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'pendiente');

    return (
        <div className="flex flex-col items-center justify-center min-h-[70vh] bg-slate-50 p-8">
            <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                <div className="bg-emerald-500 p-6 flex flex-col items-center justify-center text-white">
                    <CheckCircle className="w-16 h-16 mb-4 opacity-90" />
                    <h2 className="text-2xl font-bold tracking-tight">¡Precios Aplicados!</h2>
                    <p className="text-emerald-100 mt-1 text-sm opacity-90">Lote {latestBatch?.id.substring(0,8)} procesado</p>
                </div>

                <div className="p-8 space-y-6">
                    <div className="space-y-4">
                        <div className="flex items-center text-slate-700">
                            <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mr-3">
                                <CheckCircle className="w-4 h-4" />
                            </div>
                            <span className="font-medium text-lg">{confirmados || 0} costos</span>
                            <span className="ml-1 text-slate-500">actualizados en el catálogo</span>
                        </div>
                        
                        <div className="flex items-center text-slate-700">
                            <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mr-3">
                                <RefreshCw className="w-4 h-4 animate-spin-slow" />
                            </div>
                            <div className="flex flex-col">
                                <span className="font-medium text-lg text-slate-900">Recalculando publicaciones...</span>
                                <span className="text-sm text-slate-500">Enviando a Mercado Libre ({encolados || 0} en cola global)</span>
                            </div>
                        </div>
                    </div>

                    <div className="pt-6 mt-6 border-t border-slate-100">
                        <Link 
                            href={`/precios/${encodeURIComponent(proveedorDecoded)}`}
                            className="w-full flex items-center justify-center px-6 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors shadow-sm"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" /> Volver al Hub del Proveedor
                        </Link>
                    </div>
                </div>
            </div>
            <style dangerouslySetInnerHTML={{__html: `
                .animate-spin-slow { animation: spin 3s linear infinite; }
            `}} />
        </div>
    );
}
