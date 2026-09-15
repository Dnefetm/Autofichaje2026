import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CAMPOS_EGRESO = 'id, egreso_id, articulo_id, cantidad, tipo_egreso, importacion_full_id, guia, transportista, operador_id, notas, fecha, largo, ancho, alto, peso, salidas_periodo, codigo_ml, edo_reunido, fecha_reunido, fecha_preparado';

// GET /api/logistica-full/envio?guia=X — detalle de un envío Full (egresos + nombre de artículo).
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const guia = searchParams.get('guia');
    if (!guia) return NextResponse.json({ error: 'guia requerido' }, { status: 400 });

    const { data: egresos, error } = await supabaseAdmin
        .from('egresos')
        .select(`${CAMPOS_EGRESO}`)
        .eq('tipo_egreso', 'envio_full')
        .eq('guia', guia)
        .order('articulo_id');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Nombres de artículos (no hay FK egresos→articulos; se resuelve aparte).
    const names = new Map<string, string>();
    const ids = [...new Set((egresos || []).map(e => e.articulo_id))];
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { data: arts } = await supabaseAdmin
            .from('articulos')
            .select('articulo_id, nombre')
            .in('articulo_id', chunk);
        (arts || []).forEach(a => names.set(a.articulo_id, a.nombre));
    }

    return NextResponse.json({
        success: true,
        guia,
        count: (egresos || []).length,
        egresos: (egresos || []).map(e => ({ ...e, nombre: names.get(e.articulo_id) || null })),
    });
}

// POST /api/logistica-full/envio — avanza el estado de un envío completo.
// body: { guia, accion: 'reunir' | 'preparar' }
// Usa web_upsert_egreso (preserva todos los campos y sincroniza a Sheets vía outbox).
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { guia, accion } = body;
        if (!guia || !accion) return NextResponse.json({ error: 'guia y accion requeridos' }, { status: 400 });

        const { data: egresos, error } = await supabaseAdmin
            .from('egresos')
            .select(`${CAMPOS_EGRESO}`)
            .eq('tipo_egreso', 'envio_full')
            .eq('guia', guia);

        if (error) throw error;

        const now = new Date().toISOString();
        const nuevoEdo = accion === 'preparar' ? 'Preparado' : 'Reunido';
        let updated = 0;
        let errors = 0;

        for (const e of (egresos || [])) {
            const { error: rpcErr } = await supabaseAdmin.rpc('web_upsert_egreso', {
                p_egreso_id: e.egreso_id,
                p_articulo_id: e.articulo_id,
                p_cantidad: e.cantidad,
                p_tipo_egreso: 'envio_full',
                p_importacion_full_id: e.importacion_full_id,
                p_guia: e.guia,
                p_transportista: e.transportista,
                p_operador_id: e.operador_id,
                p_notas: e.notas,
                p_fecha: e.fecha,
                p_largo: e.largo,
                p_ancho: e.ancho,
                p_alto: e.alto,
                p_peso: e.peso,
                p_salidas_periodo: e.salidas_periodo,
                p_codigo_ml: e.codigo_ml,
                p_edo_reunido: nuevoEdo,
                p_fecha_reunido: accion === 'reunir' ? now : e.fecha_reunido,
                p_fecha_preparado: accion === 'preparar' ? now : e.fecha_preparado,
            });
            if (rpcErr) errors++; else updated++;
        }

        return NextResponse.json({ success: true, updated, errors });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error avanzando estado' }, { status: 500 });
    }
}

// PATCH /api/logistica-full/envio — ajusta la cantidad de un egreso y deja rastro del cambio.
// body: { egreso_id, cantidad }
export async function PATCH(req: Request) {
    try {
        const body = await req.json();
        const { egreso_id, cantidad } = body;
        if (!egreso_id || cantidad == null) return NextResponse.json({ error: 'egreso_id y cantidad requeridos' }, { status: 400 });
        const nueva = Number(cantidad);
        if (!Number.isFinite(nueva) || nueva < 0) return NextResponse.json({ error: 'cantidad inválida' }, { status: 400 });

        const { data: eg, error } = await supabaseAdmin
            .from('egresos')
            .select(`${CAMPOS_EGRESO}`)
            .eq('egreso_id', egreso_id)
            .maybeSingle();
        if (error) throw error;
        if (!eg) return NextResponse.json({ error: 'egreso no encontrado' }, { status: 404 });

        const original = Number(eg.cantidad || 0);
        const notaCambio = original !== nueva
            ? `[${new Date().toLocaleDateString('es-MX')}] cantidad ajustada ${original} → ${nueva}` + (eg.notas ? ' · ' + eg.notas : '')
            : eg.notas;

        const { error: rpcErr } = await supabaseAdmin.rpc('web_upsert_egreso', {
            p_egreso_id: eg.egreso_id,
            p_articulo_id: eg.articulo_id,
            p_cantidad: nueva,
            p_tipo_egreso: 'envio_full',
            p_importacion_full_id: eg.importacion_full_id,
            p_guia: eg.guia,
            p_transportista: eg.transportista,
            p_operador_id: eg.operador_id,
            p_notas: notaCambio,
            p_fecha: eg.fecha,
            p_largo: eg.largo,
            p_ancho: eg.ancho,
            p_alto: eg.alto,
            p_peso: eg.peso,
            p_salidas_periodo: eg.salidas_periodo,
            p_codigo_ml: eg.codigo_ml,
            p_edo_reunido: eg.edo_reunido,
            p_fecha_reunido: eg.fecha_reunido,
            p_fecha_preparado: eg.fecha_preparado,
        });
        if (rpcErr) throw rpcErr;

        return NextResponse.json({ success: true, original, nueva, nota: notaCambio });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error ajustando cantidad' }, { status: 500 });
    }
}
