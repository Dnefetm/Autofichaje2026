import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, Info } from 'lucide-react';
import { VinculacionClient } from '@/components/precios/VinculacionClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export default async function VinculacionPage(props: {
    params: Promise<{ proveedor: string; importacion_id: string }>;
}) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const importacionId = params.importacion_id;

    const { data: imp } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, total_filas, estado')
        .eq('id', importacionId)
        .single();

    return (
        <div className="min-h-screen bg-[var(--bg)]">
            {/* Header compacto */}
            <header className="bg-[var(--surface)] border-b border-[var(--border)] px-4 md:px-6 py-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                        <Link
                            href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial/${importacionId}/resumen`}
                            className="inline-flex items-center text-xs text-[var(--text-muted)] hover:text-[var(--accent)] mb-0.5"
                        >
                            <ArrowLeft className="w-3 h-3 mr-1" /> Resumen del Lote
                        </Link>
                        <h1 className="text-xl font-bold text-[var(--text)] leading-tight">Vinculación con Catálogo Interno</h1>
                        <p className="text-xs text-[var(--text-muted)] truncate">
                            {imp?.nombre_archivo} · {imp?.total_filas?.toLocaleString()} SKUs
                        </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0 text-[var(--text-faint)]" />
                        <span>Revisa las propuestas, los ya confirmados o los sin coincidencia.</span>
                    </div>
                </div>
            </header>

            {/* Client Component: consume la tabla materializada con paginación */}
            <VinculacionClient
                importacionId={importacionId}
                proveedor={proveedorDecoded}
            />
        </div>
    );
}
