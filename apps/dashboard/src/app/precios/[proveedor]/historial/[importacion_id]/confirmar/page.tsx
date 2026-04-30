import { supabaseAdmin } from '@/lib/supabase';
import { PriceConfirmationPanelClient } from './client-panel';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function ConfirmarPageWrapper(props: { params: Promise<{ proveedor: string, importacion_id: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    const { data: costos, error } = await supabaseAdmin
        .from('costos_articulo')
        .select('*')
        .eq('importacion_id', params.importacion_id)
        .eq('estado_match', 'completado')
        .order('actualizado_el', { ascending: false });

    return (
        <div className="p-8 max-w-5xl mx-auto">
            <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial`} className="inline-flex items-center text-sm text-indigo-600 mb-6 hover:underline">
                <ArrowLeft className="w-4 h-4 mr-1" /> Volver al historial
            </Link>
            
            {error ? (
                <div className="text-red-500">Error: {error.message}</div>
            ) : (
                <PriceConfirmationPanelClient 
                    importacionId={params.importacion_id} 
                    proveedor={proveedorDecoded} 
                    costos={costos || []}
                />
            )}
        </div>
    );
}
