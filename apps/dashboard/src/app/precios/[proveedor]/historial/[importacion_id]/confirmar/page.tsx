import { supabaseAdmin } from '@/lib/supabase';
import { PriceConfirmationPanelClient } from './client-panel';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default async function ConfirmarPageWrapper(props: { params: Promise<{ proveedor: string, importacion_id: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    let allCostos: any[] = [];
    let from = 0;
    let fetchError: any = null;
    while (true) {
        const { data: chunk, error: err } = await supabaseAdmin
            .from('costos_articulo')
            .select('*')
            .eq('importacion_id', params.importacion_id)
            .in('estado_match', ['match_exacto', 'completado', 'confirmado'])
            .range(from, from + 999);

        if (err) {
            fetchError = err;
            break;
        }
        if (!chunk || chunk.length === 0) break;
        allCostos = allCostos.concat(chunk);
        if (chunk.length < 1000) break;
        from += 1000;
    }
    const costos = allCostos;

    // Fetch previous active costs for comparison
    let allAnteriores: any[] = [];
    let fromAnt = 0;
    while (true) {
        const { data: chunkAnt } = await supabaseAdmin
            .from('costos_articulo')
            .select('*')
            .eq('proveedor', proveedorDecoded)
            .eq('vigente', true)
            .neq('importacion_id', params.importacion_id)
            .range(fromAnt, fromAnt + 999);

        if (!chunkAnt || chunkAnt.length === 0) break;
        allAnteriores = allAnteriores.concat(chunkAnt);
        if (chunkAnt.length < 1000) break;
        fromAnt += 1000;
    }
    const costosAnteriores = allAnteriores;

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
            <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial`} className="inline-flex items-center text-sm text-[var(--accent)] mb-6 hover:underline">
                <ArrowLeft className="w-4 h-4 mr-1" /> Volver al historial
            </Link>
            
            {fetchError ? (
                <div className="text-[var(--err)]">Error: {fetchError.message}</div>
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
