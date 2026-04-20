/**
 * PATCH /api/precios/importar/[id]/mapear
 *
 * 1. Valida el body.
 * 2. Guarda el mapeo de columnas en importaciones_excel y setea estado = 'en_cola'.
 * 3. Llama a la Edge Function procesar-importacion de forma fire-and-forget.
 * 4. Responde 202 Inmediatamente a la UI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
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

    if (!storagePath) {
        return NextResponse.json({ ok: false, error: 'No hay archivo asociado (storage_path no encontrado)' }, { status: 422 });
    }

    const tiposCosto = [...new Set(precios.map((p: any) => p.tipo_costo))].join(',');

    // Actualizar registro a en_cola
    const { error: updateErr } = await supabaseAdmin
        .from('importaciones_excel')
        .update({
            mapeo_columnas: {
                _storage_path: storagePath,
                _bucket: bucket,
                columna_modelo,
                columna_marca,
                precios,
                ...(columna_codigo && { columna_codigo }),
                ...(columna_descripcion && { columna_descripcion }),
                ...(columna_moneda && { columna_moneda }),
                moneda_default,
            },
            tipo_costo_default: tiposCosto,
            estado: 'en_cola',
            ultima_actividad: new Date().toISOString(),
            error_mensaje: null,
            filas_procesadas: 0,
        })
        .eq('id', id);

    if (updateErr) {
        return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
    }

    // Fire and forget
    fetch(`${process.env.SUPABASE_URL}/functions/v1/procesar-importacion`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ importacion_id: id }),
    }).catch(() => {});

    return NextResponse.json({
        ok: true,
        importacion_id: id,
        estado: 'en_cola'
    }, { status: 202 });
}
