/**
 * POST /api/precios/importar/[id]/confirmar
 *
 * Confirma o descarta matches seleccionados por el usuario.
 * Cada fila puede: confirmarse (ligando al articulo sugerido o a uno manual),
 * descartarse, o corregirse a un articulo diferente.
 *
 * Al confirmar:
 *   - estado_match = 'confirmado'
 *   - articulo_id = articulo_sugerido_id (o el override manual)
 *   - confirmado_por = user_id (o 'operador' si no hay auth)
 *   - Desactiva costos vigentes previos con mismo articulo_id + tipo_costo
 *
 * Al descartar:
 *   - estado_match = 'descartado'
 *
 * Body:
 * {
 *   acciones: Array<{
 *     costo_id: string,
 *     accion: 'confirmar' | 'descartar',
 *     articulo_id_override?: string  // solo para 'confirmar' con correccion manual
 *   }>
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface Accion {
    costo_id: string;
    accion: 'confirmar' | 'descartar';
    articulo_id_override?: string;
}

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    const body = await req.json().catch(() => null);
    const acciones: Accion[] = body?.acciones;

    if (!Array.isArray(acciones) || acciones.length === 0) {
        return NextResponse.json(
            { ok: false, error: 'Se requiere un array "acciones" con al menos un elemento' },
            { status: 400 }
        );
    }

    // Validar que la importacion existe
    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, estado')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json({ ok: false, error: 'Importacion no encontrada' }, { status: 404 });
    }

    const resultados = {
        confirmados: 0,
        descartados: 0,
        errores: [] as { costo_id: string; error: string }[],
    };

    // TODO: reemplazar por auth real cuando se implemente autenticacion
    const confirmado_por = 'operador';

    for (const accion of acciones) {
        if (!accion.costo_id || !['confirmar', 'descartar'].includes(accion.accion)) {
            resultados.errores.push({ costo_id: accion.costo_id, error: 'Accion invalida' });
            continue;
        }

        if (accion.accion === 'confirmar') {
            // Obtener el costo para saber el articulo sugerido y tipo_costo
            const { data: costo } = await supabaseAdmin
                .from('costos_articulo')
                .select('id, articulo_sugerido_id, tipo_costo, estado_match')
                .eq('id', accion.costo_id)
                .eq('importacion_id', id)
                .single();

            if (!costo) {
                resultados.errores.push({ costo_id: accion.costo_id, error: 'Costo no encontrado' });
                continue;
            }

            if (costo.estado_match === 'confirmado') {
                resultados.confirmados++;
                continue;
            }

            const articuloFinal = accion.articulo_id_override || costo.articulo_sugerido_id;

            if (!articuloFinal) {
                resultados.errores.push({
                    costo_id: accion.costo_id,
                    error: 'No hay articulo sugerido ni override para confirmar. Usa articulo_id_override.',
                });
                continue;
            }

            // ── FIX BUG 1: Desactivar costos vigentes previos ──────────────
            // Antes de marcar este costo como vigente, apagamos cualquier
            // registro existente con la misma combinacion articulo_id + tipo_costo
            // para respetar el indice UNIQUE parcial costos_articulo_vigente_unico
            const { error: deactivateErr } = await supabaseAdmin
                .from('costos_articulo')
                .update({ vigente: false })
                .eq('articulo_id', articuloFinal)
                .eq('tipo_costo', costo.tipo_costo)
                .eq('vigente', true)
                .neq('id', accion.costo_id);

            if (deactivateErr) {
                resultados.errores.push({
                    costo_id: accion.costo_id,
                    error: `Error al desactivar vigentes previos: ${deactivateErr.message}`,
                });
                continue;
            }

            // Ahora si, confirmar el costo actual
            const { error: updErr } = await supabaseAdmin
                .from('costos_articulo')
                .update({
                    estado_match: 'confirmado',
                    articulo_id: articuloFinal,
                    confirmado_por,
                    vigente: true,
                })
                .eq('id', accion.costo_id);

            if (updErr) {
                resultados.errores.push({ costo_id: accion.costo_id, error: updErr.message });
            } else {
                resultados.confirmados++;
            }
        } else if (accion.accion === 'descartar') {
            const { error: updErr } = await supabaseAdmin
                .from('costos_articulo')
                .update({ estado_match: 'descartado' })
                .eq('id', accion.costo_id)
                .eq('importacion_id', id);

            if (updErr) {
                resultados.errores.push({ costo_id: accion.costo_id, error: updErr.message });
            } else {
                resultados.descartados++;
            }
        }
    }

    // ── Actualizar estado de importacion si ya no quedan pendientes ──────────
    const { data: pendientes } = await supabaseAdmin
        .from('costos_articulo')
        .select('id')
        .eq('importacion_id', id)
        .in('estado_match', ['sin_match', 'sugerido'])
        .limit(1);

    if (!pendientes || pendientes.length === 0) {
        await supabaseAdmin
            .from('importaciones_excel')
            .update({ estado: 'completado' })
            .eq('id', id);
    }

    return NextResponse.json({
        ok: resultados.errores.length === 0,
        ...resultados,
        importacion_id: id,
    });
}