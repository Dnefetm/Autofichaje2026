import { supabaseAdmin } from '@/lib/supabase';
import { ClientDiffPanel } from './ClientDiffPanel';
import Link from 'next/link';

export default async function CompararPaso3(props: { params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    // 1. Get latest import batch
    const { data: ultimas } = await supabaseAdmin
        .from('v_importaciones_historial')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .order('creado_el', { ascending: false })
        .limit(1);

    const latestBatch = ultimas?.[0];

    if (!latestBatch) {
        return (
            <div className="p-8 text-center text-slate-500">
                No hay importaciones recientes para comparar. Sube un archivo primero.
            </div>
        );
    }

    // 2. Fetch costs pending confirmation
    const { data: costos, error } = await supabaseAdmin
        .from('costos_articulo')
        .select('*')
        .eq('importacion_id', latestBatch.id)
        .eq('estado_match', 'completado')
        .order('actualizado_el', { ascending: false });

    // 3. Fetch previous active costs for comparison
    const { data: costosAnteriores } = await supabaseAdmin
        .from('costos_articulo')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .eq('vigente', true)
        .neq('importacion_id', latestBatch.id);

    // 4. Map by articulo_id + tipo_costo
    const anterioresMap = new Map();
    if (costosAnteriores) {
        costosAnteriores.forEach(c => {
            anterioresMap.set(`${c.articulo_id}-${c.tipo_costo}`, c);
        });
    }

    const currentImportKeys = new Set((costos || []).map(c => `${c.articulo_id}-${c.tipo_costo}`));
    
    // Build Diff Array
    const diffData = [];

    // Cambios, Nuevos y Sin cambio
    (costos || []).forEach(c => {
        const anterior = anterioresMap.get(`${c.articulo_id}-${c.tipo_costo}`);
        let rowClass = 'sin_cambio';
        let deltaVal = null;
        let deltaPct = null;

        if (!anterior) {
            rowClass = 'nuevo';
        } else {
            deltaVal = c.valor - anterior.valor;
            deltaPct = (deltaVal / anterior.valor) * 100;
            if (Math.abs(deltaPct) > 0.01) {
                rowClass = 'cambio';
            }
        }

        diffData.push({
            ...c,
            valor_anterior: anterior ? anterior.valor : null,
            delta_val: deltaVal,
            delta_pct: deltaPct,
            row_class: rowClass
        });
    });

    // Ausentes
    (costosAnteriores || []).forEach(c => {
        if (!currentImportKeys.has(`${c.articulo_id}-${c.tipo_costo}`)) {
            diffData.push({
                ...c, // It's an old cost, so its 'valor' is the previous value
                valor_anterior: c.valor,
                valor: null, // No new value
                delta_val: null,
                delta_pct: null,
                row_class: 'ausente'
            });
        }
    });

    return (
        <div className="flex flex-col h-full bg-slate-50">
            {error ? (
                <div className="p-8 text-red-500">Error: {error.message}</div>
            ) : (
                <ClientDiffPanel 
                    importacion={latestBatch} 
                    proveedor={proveedorDecoded} 
                    diffData={diffData}
                />
            )}
        </div>
    );
}
