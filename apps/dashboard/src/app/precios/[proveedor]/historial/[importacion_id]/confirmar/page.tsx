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
        .in('estado_match', ['match_exacto', 'completado', 'confirmado'])
        .order('actualizado_el', { ascending: false });

    // Fetch previous active costs for comparison
    const { data: costosAnteriores } = await supabaseAdmin
        .from('costos_articulo')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .eq('vigente', true)
        .neq('importacion_id', params.importacion_id);

    // Map by articulo_id + tipo_costo
    const anterioresMap = new Map();
    if (costosAnteriores) {
        costosAnteriores.forEach(c => {
            anterioresMap.set(`${c.articulo_id}-${c.tipo_costo}`, c.valor);
        });
    }

    // Embed delta in the costos array
    const currentImportKeys = new Set((costos || []).map(c => `${c.articulo_id}-${c.tipo_costo}`));
    
    const costosConDelta = (costos || []).map(c => {
        const anterior = anterioresMap.get(`${c.articulo_id}-${c.tipo_costo}`);
        return {
            ...c,
            valor_anterior: anterior || null,
            delta_pct: anterior ? ((c.valor - anterior) / anterior) * 100 : null,
            delta_val: anterior ? (c.valor - anterior) : null
        };
    });

    const ausentes = (costosAnteriores || []).filter(c => !currentImportKeys.has(`${c.articulo_id}-${c.tipo_costo}`));

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
                    costos={costosConDelta}
                    ausentes={ausentes}
                />
            )}
        </div>
    );
}
