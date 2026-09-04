import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
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
            {/* Header mínimo: una sola línea para ceder todo el alto al área de trabajo */}
            <header className="bg-[var(--surface)] border-b border-[var(--border)] px-4 py-2 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <Link
                        href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial/${importacionId}/resumen`}
                        className="inline-flex items-center text-xs text-[var(--text-muted)] hover:text-[var(--accent)] shrink-0"
                        aria-label="Volver al resumen"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </Link>
                    <h1 className="text-base font-bold text-[var(--text)] truncate shrink-0">Vinculación</h1>
                    <span className="text-xs text-[var(--text-muted)] truncate">
                        {imp?.nombre_archivo} · {imp?.total_filas?.toLocaleString()} SKUs
                    </span>
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
