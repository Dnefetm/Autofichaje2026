import { friendlyError } from '@/lib/friendlyError';
// DEPRECADO (Flujo A). No se usa desde la UI: el "Ir a Aplicar" ahora va al resumen.
// Su trabajo lo cubren "Activar como Vigente" (activar route) y el trigger
// fn_tg_promote_pendientes (que ya marca vigente=true al vincular).
// Además usaba estado_match='aplicado', que viola chk_costos_articulo_estado_match.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request, props: { params: Promise<{ proveedor: string }> }) {
    try {
        const { importacion_id } = await req.json();

        if (!importacion_id) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        // 1. Mark existing costs as no longer vigente if they have a confirmed new cost
        // 2. Set confirmed new costs to vigente=true, estado_match='aplicado'
        // Since Supabase RPC is best for complex transactions, we can simulate or use basic updates.

        // Flip confirmed items to vigente
        const { error: err1 } = await supabaseAdmin
            .from('costos_articulo')
            .update({ vigente: true, estado_match: 'aplicado' })
            .eq('importacion_id', importacion_id)
            .in('confirmado_por', ['aprobado', 'añadir']);

        if (err1) throw err1;

        // Mark importacion as completada
        // Correccion 2026-08-25 (auditoria Fase 4): la tabla real es
        // `importaciones_excel` (no `importaciones_precios`, que nunca existio)
        // y no tiene columna `completado_el`; el timestamp de actividad es
        // `ultima_actividad`. Antes este update fallaba con 404 y toda la
        // ruta devolvia 500 AUNQUE los costos ya se hubieran aplicado.
        const { error: err2 } = await supabaseAdmin
            .from('importaciones_excel')
            .update({ estado: 'completado', ultima_actividad: new Date().toISOString() })
            .eq('id', importacion_id);

        if (err2) throw err2;

        return NextResponse.json({ success: true });
    } catch (e: any) {
        return NextResponse.json({ error: friendlyError(e) }, { status: 500 });
    }
}
