import { supabaseAdmin } from '@/lib/supabase';
import { ProductDiffPanel } from './ProductDiffPanel';

// Supabase limita a 1000 filas por query; paginar para traer todo el lote.
async function fetchAllPrecios(importacionId: string, opts: { vigente?: boolean; estado?: string }): Promise<any[]> {
    const rows: any[] = [];
    let from = 0;
    while (true) {
        let q = supabaseAdmin.from('precios_proveedor').select('*').eq('importacion_id', importacionId);
        if (opts.vigente !== undefined) q = q.eq('vigente', opts.vigente);
        if (opts.estado) q = q.eq('estado', opts.estado);
        const { data } = await q.range(from, from + 999);
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }
    return rows;
}

// Los tipos de precio son LIBRES por proveedor (Urrea: 4 niveles; Victorinox: menudeo sin/con IVA).
// No se fuerzan a un set fijo: cada tipo_costo del mapeo se convierte en una columna dinámica.
type TierValor = { vigente: number | null; nuevo: number | null; delta_pct: number | null; delta_val: number | null };

function emptyTier(): TierValor {
    return { vigente: null, nuevo: null, delta_pct: null, delta_val: null };
}

export default async function RevisarPaso2(props: { params: Promise<{ proveedor: string }> }) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);

    const { data: ultimas } = await supabaseAdmin
        .from('v_importaciones_historial')
        .select('*')
        .eq('proveedor', proveedorDecoded)
        .order('creado_el', { ascending: false })
        .limit(1);

    const latestBatch = ultimas?.[0];
    if (!latestBatch) {
        return (
            <div className="p-8 text-center text-[var(--text-muted)]">
                No hay importaciones recientes para revisar. Sube un archivo primero.
            </div>
        );
    }

    const { count: c } = await supabaseAdmin
        .from('v_importaciones_historial')
        .select('*', { count: 'exact', head: true })
        .eq('proveedor', proveedorDecoded)
        .lte('creado_el', latestBatch.creado_el);
    const loteNum = c || 1;

    const filasActuales = await fetchAllPrecios(latestBatch.id, { vigente: true });

    const { data: anterior } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id')
        .eq('proveedor', proveedorDecoded)
        .eq('estado', 'completado')
        .neq('id', latestBatch.id)
        .order('creado_el', { ascending: false })
        .limit(1);
    const prevId = anterior?.[0]?.id;

    const filasDescontinuadas = prevId ? await fetchAllPrecios(prevId, { estado: 'descontinuado' }) : [];

    const grouped = new Map<string, any>();

    const getOrCreate = (sku: string, ref: any) => {
        if (!grouped.has(sku)) {
            grouped.set(sku, {
                articulo_id: sku,
                codigo_universal: sku,
                marca: ref.marca || '',
                nombre: ref.descripcion || '',
                row_class: 'sin_cambio',
                tiers: {} as Record<string, TierValor>,
                isConfirmado: false,
                decision: 'pendiente',
            });
        }
        return grouped.get(sku);
    };

    const tierKey = (tipo: string) => (tipo || '').toLowerCase().trim();

    for (const r of filasActuales || []) {
        const sku = r.sku_proveedor;
        if (!sku) continue;
        const g = getOrCreate(sku, r);
        const k = tierKey(r.tipo_costo);
        if (!k) continue;
        if (!g.tiers[k]) g.tiers[k] = emptyTier();
        g.tiers[k].nuevo = Number(r.valor);
        g.tiers[k].vigente = r.valor_anterior != null ? Number(r.valor_anterior) : null;
        g.tiers[k].delta_pct = r.delta_pct != null ? Number(r.delta_pct) : null;
        g.tiers[k].delta_val = r.valor_anterior != null ? Number(r.valor) - Number(r.valor_anterior) : null;

        if (r.estado === 'nuevo') g.row_class = 'nuevo';
        else if (r.estado === 'actualizado') g.row_class = 'cambio';
        else if (r.estado === 'sin_cambio') g.row_class = g.row_class === 'cambio' ? 'cambio' : 'sin_cambio';

        if (r.confirmado_por === 'aprobado') { g.isConfirmado = true; g.decision = 'aprobado'; }
        else if (r.confirmado_por === 'rechazado') { g.decision = 'rechazado'; }
    }

    for (const r of filasDescontinuadas || []) {
        const sku = r.sku_proveedor;
        if (!sku) continue;
        const g = getOrCreate(sku, r);
        g.row_class = 'ausente';
        const k = tierKey(r.tipo_costo);
        if (!k) continue;
        if (!g.tiers[k]) g.tiers[k] = emptyTier();
        g.tiers[k].vigente = Number(r.valor);
        g.tiers[k].nuevo = null;
        g.tiers[k].delta_pct = null;
        g.tiers[k].delta_val = null;
    }

    const diffData = Array.from(grouped.values());

    return (
        <div className="flex flex-col h-full bg-[var(--bg)]">
            <ProductDiffPanel
                importacion={latestBatch}
                loteNum={loteNum}
                proveedor={proveedorDecoded}
                diffData={diffData}
            />
        </div>
    );
}
