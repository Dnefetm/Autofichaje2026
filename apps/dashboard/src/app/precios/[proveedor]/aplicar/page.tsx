import { supabaseAdmin } from '@/lib/supabase';
import { AplicarPanel } from './AplicarPanel';

export default async function AplicarPaso3(props: { params: Promise<{ proveedor: string }> }) {
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

    if (!latestBatch) {
        return <div className="p-8 text-center text-[var(--text-muted)]">No hay lotes para aplicar.</div>;
    }

    // Get Lote Number
    const { count: c } = await supabaseAdmin
        .from('v_importaciones_historial')
        .select('*', { count: 'exact', head: true })
        .eq('proveedor', proveedorDecoded)
        .lte('creado_el', latestBatch.creado_el);
    const loteNum = c || 1;

    // Fetch decisions from costos_articulo for this batch
    const { data: decisions } = await supabaseAdmin
        .from('costos_articulo')
        .select('articulo_id, confirmado_por, estado_match')
        .eq('importacion_id', latestBatch.id);

    // We must deduce the stats.
    // In our model, we just use confirmed rows. But since the prompt asks for specific numbers:
    // "47 precios actualizados", "12 nuevos", "3 descontinuados", "8 rechazados", "133 sin cambio".
    // We will simulate the count based on the confirmed status if we can't reliably calculate it without the full diff.
    // For exactness, let's just group them based on `confirmado_por` text values: 'aprobado', 'rechazado', 'descontinuado', etc.
    
    let actualizados = 0;
    let nuevos = 0;
    let descontinuados = 0;
    let rechazados = 0;
    let sin_cambio = 0;

    const uniqueProducts = new Map<string, string>();
    (decisions || []).forEach(d => {
        if (!uniqueProducts.has(d.articulo_id)) {
            uniqueProducts.set(d.articulo_id, d.confirmado_por);
        }
    });

    uniqueProducts.forEach((decision) => {
        if (decision === 'aprobado') actualizados++;
        else if (decision === 'rechazado') rechazados++;
        else if (decision === 'descontinuado') descontinuados++;
        else if (decision === 'añadir') nuevos++;
        else if (decision === 'mantener') sin_cambio++; // or just not counted
        else if (!decision) sin_cambio++;
    });

    // Conteos reales derivados de las decisiones confirmadas (sin valores simulados).
    const stats = {
        actualizados,
        nuevos,
        descontinuados,
        rechazados,
        sin_cambio
    };

    return (
        <AplicarPanel 
            importacion={latestBatch} 
            loteNum={loteNum} 
            stats={stats} 
            proveedor={proveedorDecoded} 
        />
    );
}
