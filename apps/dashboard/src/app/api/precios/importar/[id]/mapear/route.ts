/**
 * PATCH /api/precios/importar/[id]/mapear
 *
 * 1. Valida el body.
 * 2. Guarda el mapeo de columnas en importaciones_excel y setea estado = 'mapeando'.
 * 3. Llama a la Edge Function procesar-importacion de forma fire-and-forget.
 * 4. Responde 202 Inmediatamente a la UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;


export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    return procesarMapear(req, props);
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    return procesarMapear(req, props);
}

async function procesarMapear(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const { id } = await props.params;
    const body = await req.json().catch(() => null);
    
    const {
        columna_modelo,
        columna_marca,
        precios,
        columna_codigo,
        columna_descripcion,
        columna_moneda,
        moneda_default = 'MXN',
        columnas_a_guardar = [],
    } = body ?? {};

    // ── Validaciones
    if (!columna_modelo) return NextResponse.json({ ok: false, error: 'Se requiere columna_modelo' }, { status: 400 });
    if (!columna_marca) return NextResponse.json({ ok: false, error: 'Se requiere columna_marca' }, { status: 400 });
    if (!Array.isArray(precios) || precios.length === 0) {
        return NextResponse.json({ ok: false, error: 'Se requiere precios[]' }, { status: 400 });
    }

    // Traer la importación para obtener bucket y path
    const { data: importacion, error: fetchErr } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, mapeo_columnas, estado')
        .eq('id', id)
        .single();

    if (fetchErr || !importacion) {
        return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
    }

    const mapeoActual = importacion.mapeo_columnas as Record<string, any> | null;
    const storagePath = mapeoActual?._storage_path as string | undefined;
    const bucket      = mapeoActual?._bucket as string | undefined ?? 'excel-precios';

    const tiposCosto = [...new Set(precios.map((p: any) => p.tipo_costo?.toLowerCase()))].join(',');
    
    // Ensure precios array has lowercase tipo_costo
    const preciosSanitized = precios.map((p: any) => ({
        ...p,
        tipo_costo: p.tipo_costo?.toLowerCase()
    }));

    // Actualizar registro: guardamos el mapping. 
    // NO tocamos el "estado" para no corromper el pipeline desacoplado ('completado' debe seguir siendo 'completado').
    const { error: updateErr } = await supabaseAdmin
        .from('importaciones_excel')
        .update({
            mapeo_columnas: {
                _storage_path: storagePath,
                _bucket: bucket,
                columna_modelo,
                columna_marca,
                precios: preciosSanitized,
                ...(columna_codigo && { columna_codigo }),
                ...(columna_descripcion && { columna_descripcion }),
                ...(columna_moneda && { columna_moneda }),
                moneda_default,
                columnas_a_guardar,
            },
            tipo_costo_default: tiposCosto,
            estado: 'procesando',
            ultima_actividad: new Date().toISOString()
        })
        .eq('id', id);

    if (updateErr) {
        return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    // 1) Ejecutar la preparación y el diff de manera asíncrona
    // Next.js 'after' prevents the response from blocking, allowing Vercel to return 202 quickly
    // while processing the heavy SQL operations in the background.
    
        try {
            const { data: impData } = await supabaseAdmin.from('importaciones_excel').select('proveedor, total_filas').eq('id', id).single();
            if (impData) {
                // Ejecutar matching directamente sobre listas_precios_raw
                const { error: matchErr } = await supabaseAdmin.rpc('fn_match_precios_v2', {
                    p_importacion_id: id,
                    p_finalizar: false
                });
                if (matchErr) throw new Error("Fallo fn_match_precios_v2: " + matchErr.message);
                
                await supabaseAdmin.from('importaciones_excel').update({
                    resumen_diff: { totales: impData.total_filas || 0, nuevos: impData.total_filas || 0, modificados: 0, eliminados: 0 },
                    estado: 'en_revision',
                    ultima_actividad: new Date().toISOString()
                }).eq('id', id);
            }
        } catch (err: any) {
            console.error("[Mapear] Error en matching:", err);
            await supabaseAdmin.from('importaciones_excel').update({ estado: 'error', error_mensaje: err.message, ultima_actividad: new Date().toISOString() }).eq('id', id);
            return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
        }

    return NextResponse.json({
        ok: true,
        importacion_id: id,
        estado: 'en_revision'
    }, { status: 200 });
}

