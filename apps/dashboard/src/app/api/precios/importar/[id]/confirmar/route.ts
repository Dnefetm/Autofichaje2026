/**
 * POST /api/precios/importar/[id]/confirmar
 *
 * Confirma o descarta matches seleccionados por el usuario.
 * Cada fila puede: confirmarse (ligando al artículo sugerido o a uno manual),
 * descartarse, o corregirse a un artículo diferente.
 *
 * Al confirmar:
 *   - estado_match = 'confirmado'
 *   - articulo_id = articulo_sugerido_id (o el override manual)
 *   - confirmado_por = user_id (o 'operador' si no hay auth)
 *
 * Al descartar:
 *   - estado_match = 'rechazado'
 *
 * Body:
 * {
 *   acciones: Array<{
 *     costo_id: string,
 *     accion: 'confirmar' | 'descartar',
 *     articulo_id_override?: string  // solo para 'confirmar' con corrección manual
 *   }>
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface Accion {
    costo_id: string;
    accion: 'confirmar' | 'descartar';
    articulo_id_override?: string; // solo para 'confirmar' con corrección manual
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

    // Validar que la importación existe
    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, estado')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    const resultados = {
        confirmados: 0,
        descartados: 0,
        errores: [] as { costo_id: string; error: string }[],
    };

    // TODO: reemplazar por auth real cuando se implemente autenticación
    const confirmado_por = 'operador';

    for (const accion of acciones) {
        if (!accion.costo_id || !['confirmar', 'descartar'].includes(accion.accion)) {
            resultados.errores.push({ costo_id: accion.costo_id, error: 'Acción inválida' });
            continue;
        }

        if (accion.accion === 'confirmar') {
            // Obtener el costo para saber el artículo sugerido
            const { data: costo } = await supabaseAdmin
                .from('costos_articulo')
                .select('id, articulo_sugerido_id, estado_match')
                .eq('id', accion.costo_id)
                .eq('importacion_id', id)
                .single();

            if (!costo) {
                resultados.errores.push({ costo_id: accion.costo_id, error: 'Costo no encontrado' });
                continue;
            }

            if (costo.estado_match === 'confirmado') {
                resultados.confirmados++; // ya estaba confirmado, skip
                continue;
            }

            const articuloFinal = accion.articulo_id_override || costo.articulo_sugerido_id;
            if (!articuloFinal) {
                resultados.errores.push({
                    costo_id: accion.costo_id,
                    error: 'No hay artículo sugerido ni override para confirmar. Usa articulo_id_override.',
                });
                continue;
            }

            const { error: updErr } = await supabaseAdmin
                .from('costos_articulo')
                .update({
                    estado_match: 'confirmado',
                    articulo_id: articuloFinal,
                    confirmado_por,
                    vigente: true,  // el costo está activo a partir de la confirmación
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
                .update({ estado_match: 'rechazado' })
                .eq('id', accion.costo_id)
                .eq('importacion_id', id);

            if (updErr) {
                resultados.errores.push({ costo_id: accion.costo_id, error: updErr.message });
            } else {
                resultados.descartados++;
            }
        }
    }

    // ── Actualizar estado de importación si ya no quedan pendientes ──────────
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
