import { supabaseAdmin } from '@/lib/supabase';
import { ProductDiffPanel } from './ProductDiffPanel';

export default async function RevisarPaso2(props: { params: Promise<{ proveedor: string }> }) {
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
                No hay importaciones recientes para revisar. Sube un archivo primero.
            </div>
        );
    }

    // Get total batches count to show the real batch number
    const { count: c } = await supabaseAdmin
        .from('v_importaciones_historial')
        .select('*', { count: 'exact', head: true })
        .eq('proveedor', proveedorDecoded)
        .lte('creado_el', latestBatch.creado_el);
    const loteNum = c || 1;

    // 2. Fetch costs pending confirmation
    const { data: costosNuevos, error } = await supabaseAdmin
        .from('costos_articulo')
        .select('*, articulo:articulo_id(nombre)') // Assuming we can join with articulo table if needed, otherwise fallback to excel fields
        .eq('importacion_id', latestBatch.id)
        .eq('estado_match', 'completado')
        .order('actualizado_el', { ascending: false });

    // 3. Fetch previous active costs for comparison
    const { data: costosVigentes } = await supabaseAdmin
        .from('costos_articulo')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .eq('vigente', true)
        .neq('importacion_id', latestBatch.id);

    // Grouping by articulo_id
    const groupedMap = new Map<string, any>();

    const getOrCreateGroup = (articulo_id: string, refItem: any) => {
        if (!groupedMap.has(articulo_id)) {
            groupedMap.set(articulo_id, {
                articulo_id,
                codigo_universal: refItem.codigo_excel || '-', // Fallback
                marca: refItem.marca_excel || '',
                modelo: refItem.modelo_excel || '',
                nombre: refItem.articulo?.nombre || refItem.nombre || '',
                row_class: 'sin_cambio', // default
                tiers: {
                    distribuidor: { vigente: null, nuevo: null, id_nuevo: null },
                    subdistribuidor: { vigente: null, nuevo: null, id_nuevo: null },
                    mayoreo: { vigente: null, nuevo: null, id_nuevo: null },
                    menudeo: { vigente: null, nuevo: null, id_nuevo: null }
                }
            });
        }
        return groupedMap.get(articulo_id);
    };

    // Populate Vigentes
    (costosVigentes || []).forEach(v => {
        if (!v.articulo_id) return;
        const group = getOrCreateGroup(v.articulo_id, v);
        // Normalize tipo_costo to match tiers
        const t = v.tipo_costo.toLowerCase();
        const tierKey = t.includes('distribuidor') && !t.includes('sub') ? 'distribuidor' :
                        t.includes('subdistribuidor') ? 'subdistribuidor' :
                        t.includes('mayoreo') ? 'mayoreo' :
                        t.includes('menudeo') ? 'menudeo' : null;
        if (tierKey) {
            group.tiers[tierKey].vigente = v.valor;
        }
    });

    // Populate Nuevos
    (costosNuevos || []).forEach(n => {
        if (!n.articulo_id) return;
        const group = getOrCreateGroup(n.articulo_id, n);
        // Update basic info in case it's a new product
        if (!group.codigo_universal || group.codigo_universal === '-') group.codigo_universal = n.codigo_excel;
        if (!group.marca) group.marca = n.marca_excel;
        if (!group.modelo) group.modelo = n.modelo_excel;

        const t = n.tipo_costo.toLowerCase();
        const tierKey = t.includes('distribuidor') && !t.includes('sub') ? 'distribuidor' :
                        t.includes('subdistribuidor') ? 'subdistribuidor' :
                        t.includes('mayoreo') ? 'mayoreo' :
                        t.includes('menudeo') ? 'menudeo' : null;
        if (tierKey) {
            group.tiers[tierKey].nuevo = n.valor;
            group.tiers[tierKey].id_nuevo = n.id; // Keep the ID so we can confirm it
            group.isConfirmado = n.confirmado_por !== null;
        }
    });

    // Compute Deltas and Row Class
    const diffData = Array.from(groupedMap.values()).map(g => {
        let isNuevo = true;
        let isAusente = true;
        let hasCambios = false;

        Object.keys(g.tiers).forEach(k => {
            const t = g.tiers[k];
            if (t.vigente !== null) isNuevo = false;
            if (t.nuevo !== null) isAusente = false;

            if (t.vigente !== null && t.nuevo !== null) {
                t.delta_val = t.nuevo - t.vigente;
                t.delta_pct = (t.delta_val / t.vigente) * 100;
                if (Math.abs(t.delta_pct) > 0.01) hasCambios = true;
            }
        });

        if (isNuevo) g.row_class = 'nuevo';
        else if (isAusente) g.row_class = 'ausente';
        else if (hasCambios) g.row_class = 'cambio';
        else g.row_class = 'sin_cambio';

        // Do not return products that are already confirmed. 
        // Wait, the prompt says "X aprobados · Y rechazados · Z pendientes". So we return them all, 
        // and let the client panel handle the state, but we need to know their current decision state.
        g.decision = g.isConfirmado ? 'aprobado' : 'pendiente'; // Simplified. In a real app we might store 'rechazado' somewhere else or as a column.

        return g;
    });

    // Remove old ClientDiffPanel and use ProductDiffPanel
    return (
        <div className="flex flex-col h-full bg-slate-50">
            {error ? (
                <div className="p-8 text-red-500">Error: {error.message}</div>
            ) : (
                <ProductDiffPanel 
                    importacion={latestBatch} 
                    loteNum={loteNum}
                    proveedor={proveedorDecoded} 
                    diffData={diffData}
                />
            )}
        </div>
    );
}
