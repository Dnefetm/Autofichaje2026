import { friendlyError } from '@/lib/friendlyError';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// Mundo 1: las decisiones de auditoría se persisten sobre precios_proveedor
// y TIENEN consecuencia real:
//   - Rechazar un "cambio"  -> revierte al precio anterior (valor = valor_anterior, estado 'sin_cambio')
//   - Rechazar un "nuevo"   -> lo excluye del lote vigente (vigente = false)
//   - Rechazar un "ausente" -> lo restaura (vigente = true, estado 'sin_cambio')
//   - Aprobar               -> confirma y deja el valor como está
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
            if (!d || d === 'pendiente') continue;
            if (!byDecision[d]) byDecision[d] = [];
            byDecision[d].push(sku);
        }

        let updatedCount = 0;
        const now = new Date().toISOString();

        for (const decision in byDecision) {
            const skus = byDecision[decision];
            if (skus.length === 0) continue;

            if (decision === 'rechazado') {
                // 1. Marcar como rechazado todas las filas del SKU en el lote actual
                await supabaseAdmin
                    .from('precios_proveedor')
                    .update({ confirmado_por: 'rechazado', actualizado_el: now })
                    .eq('importacion_id', importacion_id)
                    .eq('vigente', true)
                    .in('sku_proveedor', skus);

                // 2. Revertir cambios de precio: mantener el precio anterior
                const { data: rows } = await supabaseAdmin
                    .from('precios_proveedor')
                    .select('id, valor, valor_anterior')
                    .eq('importacion_id', importacion_id)
                    .eq('vigente', true)
                    .in('sku_proveedor', skus);

                for (const r of rows || []) {
                    if (r.valor_anterior != null && Number(r.valor) !== Number(r.valor_anterior)) {
                        const { error: revErr } = await supabaseAdmin
                            .from('precios_proveedor')
                            .update({ valor: r.valor_anterior, delta_pct: null, estado: 'sin_cambio', actualizado_el: now })
                            .eq('id', r.id);
                        if (revErr) throw revErr;
                        updatedCount++;
                    }
                }

                // 3. Nuevos rechazados ("Ignorar"): excluirlos del lote vigente
                const { data: nuevos, error: eNuevos } = await supabaseAdmin
                    .from('precios_proveedor')
                    .update({ vigente: false, confirmado_por: 'rechazado', actualizado_el: now })
                    .eq('importacion_id', importacion_id)
                    .eq('vigente', true)
                    .eq('estado', 'nuevo')
                    .in('sku_proveedor', skus)
                    .select('id');
                if (eNuevos) throw eNuevos;
                updatedCount += nuevos ? nuevos.length : 0;

                // 4. Descontinuados rechazados ("Mantener vigente"): restaurarlos
                const { data: restaurados, error: eRest } = await supabaseAdmin
                    .from('precios_proveedor')
                    .update({ vigente: true, estado: 'sin_cambio', confirmado_por: 'rechazado', actualizado_el: now })
                    .eq('proveedor', proveedor)
                    .eq('estado', 'descontinuado')
                    .in('sku_proveedor', skus)
                    .select('id');
                if (eRest) throw eRest;
                updatedCount += restaurados ? restaurados.length : 0;

            } else if (decision === 'aprobado') {
                // Aprobar: confirma (deja el valor como está) sobre el lote actual y los descontinuados
                const { data: d1, error: e1 } = await supabaseAdmin
                    .from('precios_proveedor')
                    .update({ confirmado_por: 'aprobado', actualizado_el: now })
                    .eq('importacion_id', importacion_id)
                    .in('sku_proveedor', skus)
                    .select('id');
                if (e1) throw e1;
                updatedCount += d1 ? d1.length : 0;

                const { data: d2, error: e2 } = await supabaseAdmin
                    .from('precios_proveedor')
                    .update({ confirmado_por: 'aprobado', actualizado_el: now })
                    .eq('proveedor', proveedor)
                    .eq('estado', 'descontinuado')
                    .in('sku_proveedor', skus)
                    .select('id');
                if (e2) throw e2;
                updatedCount += d2 ? d2.length : 0;
            }
        }

        return NextResponse.json({ success: true, count: updatedCount });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
