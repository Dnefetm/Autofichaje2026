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
        return <div className="p-12 text-center text-[var(--text-muted)]">Falta el parámetro importacion_id</div>;
    }

    const { data: decisiones, error } = await supabaseAdmin
        .from('matching_decisiones')
        .select('*')
        .eq('importacion_id', importacionId)
        .eq('estado', 'pendiente');

    return (
        <div className="flex flex-col h-[calc(100vh-80px)]">
            <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
                <div className="flex flex-col">
                    <div className="flex items-center text-sm text-[var(--text-muted)] mb-1">
                        <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}`} className="hover:text-[var(--accent)] transition flex items-center">
                            <ArrowLeft className="w-3 h-3 mr-1" /> {proveedorDecoded}
                        </Link>
                        <span className="mx-2">/</span>
                        <span className="font-medium text-[var(--text-muted)]">Confirmación de Matching</span>
                    </div>
                    <h1 className="text-2xl font-bold text-[var(--text)] tracking-tight">Revisión de Artículos</h1>
                </div>
            </header>

            <div className="p-4 bg-[var(--bg)] border-b border-[var(--border)] shrink-0 flex gap-3">
                <button className="btn-primary" onClick={() => {/* Implementar llamada a RPC */}}>Confirmar selección (N)</button>
                <button className="btn-outline-indigo" onClick={() => {/* Implementar llamada a RPC */}}>Confirmar todos</button>
                <button className="btn-outline-indigo" onClick={() => {/* Implementar llamada a RPC */}}>Confirmar siguiente lote de 200</button>
            </div>

            <div className="flex-1 overflow-auto bg-[var(--surface)] p-6">
                <h3 className="text-lg font-medium mb-4">Artículos pendientes ({decisiones?.length || 0})</h3>
                {error ? (
                    <div className="text-red-600">Error: {error.message}</div>
                ) : !decisiones || decisiones.length === 0 ? (
                    <div className="text-[var(--text-muted)]">No hay decisiones pendientes.</div>
                ) : (
                    <div className="space-y-4">
                        {decisiones.map(d => (
                            <div key={d.id} className="border p-4 rounded flex items-center gap-4">
                                <input type="checkbox" className="h-5 w-5 rounded text-[var(--accent)] focus:ring-[var(--accent)]" />
                                <div>
                                    <div className="font-bold">{d.codigo_universal_excel} - {d.nombre_excel}</div>
                                    <div className="text-sm text-[var(--text-muted)]">Sugerido: {d.cand_codigo} - {d.cand_nombre} ({d.pct}%)</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <style dangerouslySetInnerHTML={{__html: `
                .btn-primary { @apply inline-flex items-center px-4 py-2 bg-[var(--accent)] border border-transparent rounded-md font-medium text-[var(--accent-ink)] hover:brightness-110 shadow-sm text-sm transition-colors; }
                .btn-outline-indigo { @apply inline-flex items-center px-4 py-2 bg-[var(--surface)] border border-[var(--accent)]/30 rounded-md font-medium text-indigo-700 hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/50 shadow-sm text-sm transition-colors; }
            `}} />
        </div>
    );
}
