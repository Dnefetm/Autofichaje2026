import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Mundo 1: las decisiones de auditoría se persisten sobre precios_proveedor
// (autónomo del catálogo), no sobre costos_articulo.
export async function POST(req: Request, props: { params: Promise<{ proveedor: string }> }) {
    try {
        const { proveedor: provParam } = await props.params;
        const proveedor = decodeURIComponent(provParam);
        const { decisiones, importacion_id } = await req.json();

        if (!decisiones || !importacion_id) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        // decisiones: { sku_proveedor: 'aprobado' | 'rechazado' | 'pendiente' }
        const byDecision: Record<string, string[]> = {};
        for (const sku in decisiones) {
            const d = decisiones[sku];
            if (!d || d === 'pendiente') continue; // sin decisión no se persiste
            if (!byDecision[d]) byDecision[d] = [];
            byDecision[d].push(sku);
        }

        let updatedCount = 0;

        for (const decision in byDecision) {
            const skus = byDecision[decision];
            if (skus.length === 0) continue;

            // 1) Filas del lote actual (nuevo/cambio/sin_cambio)
            const { data: d1, error: e1 } = await supabaseAdmin
                .from('precios_proveedor')
                .update({ confirmado_por: decision, actualizado_el: new Date().toISOString() })
                .eq('importacion_id', importacion_id)
                .in('sku_proveedor', skus)
                .select('id');

            if (e1) throw e1;
            updatedCount += d1 ? d1.length : 0;

            // 2) Filas descontinuadas (lista anterior ausente en la nueva)
            const { data: d2, error: e2 } = await supabaseAdmin
                .from('precios_proveedor')
                .update({ confirmado_por: decision, actualizado_el: new Date().toISOString() })
                .eq('proveedor', proveedor)
                .eq('estado', 'descontinuado')
                .in('sku_proveedor', skus)
                .select('id');

            if (e2) throw e2;
            updatedCount += d2 ? d2.length : 0;
        }

        return NextResponse.json({ success: true, count: updatedCount });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
