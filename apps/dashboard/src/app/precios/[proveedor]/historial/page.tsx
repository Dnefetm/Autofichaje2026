import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, Clock, History } from 'lucide-react';
import { LoteActions } from '@/components/precios/LoteActions';

export default async function HistorialProveedorPage(props: { params: Promise<{ proveedor: string }>, searchParams: Promise<any> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    const { data: historial, error } = await supabaseAdmin
        .from('v_importaciones_historial')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .order('creado_el', { ascending: false });

    return (
        <div className="flex flex-col h-[calc(100vh-80px)]">
            <header className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
                <div className="flex flex-col">
                    <div className="flex items-center text-sm text-[var(--text-muted)] mb-1">
                        <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}`} className="hover:text-[var(--accent)] transition flex items-center">
                            <ArrowLeft className="w-3 h-3 mr-1" /> {proveedorDecoded}
                        </Link>
                        <span className="mx-2">/</span>
                        <span className="font-medium text-[var(--text-muted)]">Historial</span>
                    </div>
                    <h1 className="text-2xl font-bold text-[var(--text)] tracking-tight">Historial de Importaciones</h1>
                </div>
                <div className="flex space-x-3">
                    <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/pendientes`} className="inline-flex items-center px-4 py-2 bg-yellow-50 text-yellow-700 border border-yellow-200 rounded-md font-medium hover:bg-yellow-100 transition-colors">
                        Ver Pendientes
                    </Link>
                    <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/actualizar`} className="inline-flex items-center px-4 py-2 bg-[var(--accent)] text-[var(--accent-ink)] rounded-md font-medium hover:brightness-110 transition-colors shadow-sm">
                        Actualizar Lista
                    </Link>
                </div>
            </header>

            <div className="flex-1 overflow-auto bg-[var(--surface)] p-6">
                {error ? (
                    <div className="text-red-600">Error: {error.message}</div>
                ) : !historial || historial.length === 0 ? (
                    <div className="text-[var(--text-muted)]">No hay historial para este proveedor.</div>
                ) : (
                    <div className="space-y-4">
                        {historial.map(h => (
                            <div key={h.id} className="border p-4 rounded bg-[var(--bg)] flex justify-between items-center">
                                <div>
                                    <div className="font-bold">Lote: {h.id}</div>
                                    <div className="text-sm text-[var(--text-muted)]">Fecha: {new Date(h.creado_el).toLocaleString()}</div>
                                    <div className="text-sm">Estado: <span className="font-medium">{h.estado}</span></div>
                                    <div className="text-sm">Vigente: <span className="font-medium">{h.vigente ? 'Sí' : 'No'}</span></div>
                                </div>
                                <div>
                                    <LoteActions importacion={h} proveedor={proveedorDecoded} />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <style dangerouslySetInnerHTML={{__html: `
                .btn-outline-indigo { @apply inline-flex items-center px-4 py-2 bg-[var(--surface)] border border-[var(--accent)]/30 rounded-md font-medium text-indigo-700 hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/50 shadow-sm text-sm transition-colors; }
            `}} />
        </div>
    );
}
