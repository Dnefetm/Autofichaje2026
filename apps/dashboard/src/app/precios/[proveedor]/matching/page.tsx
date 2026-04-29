import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, Clock, History, CheckSquare, Search } from 'lucide-react';

export default async function MatchingPage(props: { params: Promise<{ proveedor: string }>, searchParams: Promise<any> }) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    
    // Asumimos que viene el importacion_id por query param
    const importacionId = searchParams.importacion_id;
    
    if (!importacionId) {
        return <div className="p-12 text-center text-slate-500">Falta el parámetro importacion_id</div>;
    }

    const { data: decisiones, error } = await supabaseAdmin
        .from('matching_decisiones')
        .select('*')
        .eq('importacion_id', importacionId)
        .eq('estado', 'pendiente');

    return (
        <div className="flex flex-col h-[calc(100vh-80px)]">
            <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white shrink-0">
                <div className="flex flex-col">
                    <div className="flex items-center text-sm text-slate-500 mb-1">
                        <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}`} className="hover:text-indigo-600 transition flex items-center">
                            <ArrowLeft className="w-3 h-3 mr-1" /> {proveedorDecoded}
                        </Link>
                        <span className="mx-2">/</span>
                        <span className="font-medium text-slate-700">Confirmación de Matching</span>
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Revisión de Artículos</h1>
                </div>
            </header>

            <div className="p-4 bg-slate-50 border-b border-slate-200 shrink-0 flex gap-3">
                <button className="btn-primary" onClick={() => {/* Implementar llamada a RPC */}}>Confirmar selección (N)</button>
                <button className="btn-outline-indigo" onClick={() => {/* Implementar llamada a RPC */}}>Confirmar todos</button>
                <button className="btn-outline-indigo" onClick={() => {/* Implementar llamada a RPC */}}>Confirmar siguiente lote de 200</button>
            </div>

            <div className="flex-1 overflow-auto bg-white p-6">
                <h3 className="text-lg font-medium mb-4">Artículos pendientes ({decisiones?.length || 0})</h3>
                {error ? (
                    <div className="text-red-600">Error: {error.message}</div>
                ) : !decisiones || decisiones.length === 0 ? (
                    <div className="text-slate-500">No hay decisiones pendientes.</div>
                ) : (
                    <div className="space-y-4">
                        {decisiones.map(d => (
                            <div key={d.id} className="border p-4 rounded flex items-center gap-4">
                                <input type="checkbox" className="h-5 w-5 rounded text-indigo-600 focus:ring-indigo-500" />
                                <div>
                                    <div className="font-bold">{d.codigo_universal_excel} - {d.nombre_excel}</div>
                                    <div className="text-sm text-slate-600">Sugerido: {d.cand_codigo} - {d.cand_nombre} ({d.pct}%)</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <style dangerouslySetInnerHTML={{__html: `
                .btn-primary { @apply inline-flex items-center px-4 py-2 bg-indigo-600 border border-transparent rounded-md font-medium text-white hover:bg-indigo-700 shadow-sm text-sm transition-colors; }
                .btn-outline-indigo { @apply inline-flex items-center px-4 py-2 bg-white border border-indigo-200 rounded-md font-medium text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 shadow-sm text-sm transition-colors; }
            `}} />
        </div>
    );
}
