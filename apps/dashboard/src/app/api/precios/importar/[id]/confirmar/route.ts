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
 *   - estado_match = 'rechazado'
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
    articulo_id_override?: string; // solo para 'confirmar' con corrección manual
}

export async function POST(
    req: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    const { id } = await props.params;
    const body = await req.json().catch(() => null);
    const acciones: Accion[] = body?.acciones;

    if (!Array.isArray(acciones)) {
        return NextResponse.json(
            { ok: false, error: 'Se requiere un array "acciones"' },
            { status: 400 }
        );
    }

    // Filtrar acciones vacías (p.ej. selecciones "Sin asignar" no enviadas como descartar explícito)
    const validAcciones = acciones.filter(a => a && a.costo_id && ['confirmar', 'descartar'].includes(a.accion));
    if (validAcciones.length === 0) {
        return NextResponse.json({ ok: false, error: 'No hay acciones válidas a procesar' }, { status: 400 });
    }

    // Validar importación
    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, proveedor')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json({ ok: false, error: 'Importacion no encontrada' }, { status: 404 });
    }

    const resultados = { confirmados: 0, descartados: 0, errores: [] as { costo_id: string; error: string }[] };
    const confirmado_por = 'operador';

    // Crear Batch si hay confirmaciones
    const numConfirmar = validAcciones.filter(a => a.accion === 'confirmar').length;
    let batchId: string | null = null;
    if (numConfirmar > 0) {
        const { data: batch, error: batchErr } = await supabaseAdmin
            .from('precio_import_batches')
            .insert({
                importacion_excel_id: id,
                usuario: confirmado_por,
                archivo: importacion.nombre_archivo,
                filas_afectadas: numConfirmar
            })
            .select('id')
            .single();

        if (batchErr || !batch) {
            console.error(JSON.stringify({ event: 'batch_error', error: batchErr }));
            return NextResponse.json({ ok: false, error: 'No se pudo crear el registro de Batch' }, { status: 500 });
        }
        batchId = batch.id;
    }

    // Procesamiento
    for (const accion of validAcciones) {
        if (accion.accion === 'confirmar') {
            const { data: costo } = await supabaseAdmin
                .from('costos_articulo')
                .select('id, articulo_sugerido_id, tipo_costo, valor, moneda, estado_match')
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
                resultados.errores.push({ costo_id: accion.costo_id, error: 'No hay articulo_id_override ni sugerido' });
                continue;
            }

            // Validar que el artículo exista en la BD principal
            const { data: artCheck, error: artErr } = await supabaseAdmin
                .from('articulos')
                .select('articulo_id')
                .eq('articulo_id', articuloFinal)
                .single();

            if (artErr || !artCheck) {
                console.log(JSON.stringify({ event: 'articulo_huerfano', costo_id: accion.costo_id, articulo_id: articuloFinal }));
                resultados.errores.push({ costo_id: accion.costo_id, error: 'El artículo ya no existe' });
                continue;
            }

            // Buscar costo anterior
            const { data: costoAnterior } = await supabaseAdmin
                .from('costos_articulo')
                .select('valor')
                .eq('articulo_id', articuloFinal)
                .eq('tipo_costo', costo.tipo_costo)
                .eq('vigente', true)
                .neq('id', accion.costo_id)
                .maybeSingle();

            // Apagar costos anteriores
            await supabaseAdmin
                .from('costos_articulo')
                .update({ vigente: false })
                .eq('articulo_id', articuloFinal)
                .eq('tipo_costo', costo.tipo_costo)
                .eq('vigente', true)
                .neq('id', accion.costo_id);

            // Guardar Historial del Proveedor de forma idempotente
            if (batchId) {
                const { error: histErr } = await supabaseAdmin
                    .from('precios_historial_proveedor')
                    .upsert({
                        batch_id: batchId,
                        costo_articulo_id: costo.id,
                        articulo_id: articuloFinal,
                        tipo_costo: costo.tipo_costo,
                        valor_antiguo: costoAnterior ? costoAnterior.valor : null,
                        valor_nuevo: costo.valor,
                        moneda: costo.moneda
                    }, { onConflict: 'batch_id, costo_articulo_id' });
                
                if (histErr) {
                    console.error(JSON.stringify({ event: 'history_insert_error', costo_id: accion.costo_id, error: histErr }));
                }
            }

            // Confirmar
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

    // Actualizar batch si hubo errores (rollback opcional, pero aquí solo registramos log)
    console.log(JSON.stringify({ event: 'confirmar_finalizado', id, confirmados: resultados.confirmados, descartados: resultados.descartados }));

    // Cierre
    const { count: pendientes } = await supabaseAdmin
        .from('costos_articulo')
        .select('id', { count: 'exact', head: true })
        .eq('importacion_id', id)
        .in('estado_match', ['sin_match', 'sugerido']);

    if (pendientes === 0) {
        await supabaseAdmin.from('importaciones_excel').update({ estado: 'completado' }).eq('id', id);
    }

    return NextResponse.json({
        ok: resultados.errores.length === 0,
        ...resultados,
        importacion_id: id,
        batch_id: batchId,
    });
}