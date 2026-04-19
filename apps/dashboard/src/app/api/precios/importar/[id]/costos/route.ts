/**
 * GET /api/precios/importar/[id]/costos
 *
 * Devuelve los costos generados para una importación específica,
 * consultando v_costos_pendientes para la revisión humana.
 *
 * Query params opcionales:
 *  - estado: sin_match | sugerido | todos (default: todos los pendientes)
 *  - limit: number (default 200)
 *  - offset: number (default 0)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    const { searchParams } = req.nextUrl;
    const estadoFiltro = searchParams.get('estado') || 'todos';
    const limit  = Math.min(parseInt(searchParams.get('limit') || '200', 10), 500);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // ── Verificar que la importación existe ──────────────────────────────────
    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, proveedor, total_filas, filas_con_match, estado, tipo_costo_default')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json(
            { ok: false, error: 'Importación no encontrada' },
            { status: 404 }
        );
    }

    // ── Consultar costos con campos del Excel ──────────────────────────────
    let query = supabaseAdmin
        .from('costos_articulo')
        .select(`
            id,
            articulo_id,
            articulo_sugerido_id,
            modelo_excel,
            marca_excel,
            codigo_universal_excel,
            descripcion_excel,
            tipo_costo,
            valor,
            moneda,
            fuente,
            puntaje_match,
            estado_match,
            confirmado_por,
            creado_el,
            candidatos_jsonb
        `)
        .eq('importacion_id', id)
        .order('puntaje_match', { ascending: false, nullsFirst: false })
        .order('creado_el', { ascending: false })
        .range(offset, offset + limit - 1);

    if (estadoFiltro !== 'todos') {
        query = query.eq('estado_match', estadoFiltro);
    } else {
        query = query.in('estado_match', ['sin_match', 'sugerido']);
    }

    const { data: costos, error: costosErr } = await query;

    if (costosErr) {
        return NextResponse.json(
            { ok: false, error: `Error al consultar costos: ${costosErr.message}` },
            { status: 500 }
        );
    }

    // ── Enriquecer con datos del artículo sugerido y candidatos (incluyendo caja_madre) ──
    const articuloIdsSet = new Set<string>();
    (costos ?? []).forEach(c => {
        if (c.articulo_sugerido_id) articuloIdsSet.add(c.articulo_sugerido_id);
        if (Array.isArray(c.candidatos_jsonb)) {
            c.candidatos_jsonb.forEach((cand: any) => {
                if (cand.articulo_id) articuloIdsSet.add(cand.articulo_id);
            });
        }
    });
    const articuloIds = Array.from(articuloIdsSet);

    let articulosMap: Record<string, any> = {};
    if (articuloIds.length > 0) {
        const { data: arts } = await supabaseAdmin
            .from('articulos')
            .select('articulo_id, nombre, marca, modelo, codigo_universal, caja_madre')
            .in('articulo_id', articuloIds);

        articulosMap = Object.fromEntries((arts ?? []).map((a) => [a.articulo_id, a]));
    }

    const costosEnriquecidos = (costos ?? []).map((c) => ({
        ...c,
        articulo_sugerido: c.articulo_sugerido_id
            ? articulosMap[c.articulo_sugerido_id] ?? null
            : null,
        candidatos_jsonb: Array.isArray(c.candidatos_jsonb)
            ? c.candidatos_jsonb.map((cand: any) => ({
                ...cand,
                caja_madre: articulosMap[cand.articulo_id]?.caja_madre ?? null
              }))
            : c.candidatos_jsonb
    }));

    // ── Conteo general de estados ──────────────────────────────────────────
    const { data: conteo } = await supabaseAdmin
        .from('costos_articulo')
        .select('estado_match')
        .eq('importacion_id', id);

    const stats = {
        sin_match: 0,
        sugerido: 0,
        confirmado: 0,
        rechazado: 0,
    };
    (conteo ?? []).forEach((c) => {
        const k = c.estado_match as keyof typeof stats;
        if (k in stats) stats[k]++;
    });

    return NextResponse.json({
        ok: true,
        importacion,
        costos: costosEnriquecidos,
        total_pendientes: stats.sin_match + stats.sugerido,
        stats,
        pagination: { limit, offset },
    });
}
