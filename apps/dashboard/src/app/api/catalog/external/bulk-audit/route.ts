import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * POST /api/catalog/external/bulk-audit
 * Body: { ids: string[], ambito?: 'precio' | 'publicacion', accion?: string }
 * Marca masivamente publicaciones como auditadas de forma eficiente.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const { ids, ambito = 'precio', accion = 'revisada_ok' } = body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return NextResponse.json({ error: 'Faltan IDs para auditar' }, { status: 400 });
        }

        const fecha = new Date().toISOString();
        const colFecha = ambito === 'precio' ? 'ultima_auditoria_precio_el' : 'ultima_auditoria_pub_el';
        const colAccion = ambito === 'precio' ? 'ultima_auditoria_precio_accion' : 'ultima_auditoria_pub_accion';

        // 1. Actualizar publicaciones en lote
        const { error: updateError } = await supabaseAdmin
            .from('publicaciones_externas')
            .update({ [colFecha]: fecha, [colAccion]: accion })
            .in('id', ids);

        if (updateError) {
            throw updateError;
        }

        // 2. Registrar en la bitácora
        const logs = ids.map(id => ({
            publicacion_id: id,
            ambito,
            accion,
            detalle: { manual: true, origen: 'urgencia_masiva' }
        }));

        const { error: logError } = await supabaseAdmin
            .from('publicacion_auditoria_log')
            .insert(logs);

        if (logError) {
            console.warn('[bulk-audit] Advertencia al registrar log de auditoría:', logError);
        }

        return NextResponse.json({
            ok: true,
            count: ids.length,
            message: `${ids.length} publicaciones marcadas como auditadas.`
        });
    } catch (err: any) {
        console.error('[POST /api/catalog/external/bulk-audit]', err);
        return NextResponse.json({ error: err.message || 'Error interno' }, { status: 500 });
    }
}
