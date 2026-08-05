import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await props.params;
        const body = await req.json();

        const { data: imp, error: fErr } = await supabaseAdmin
            .from('importaciones_excel')
            .select('mapeo_columnas, estado')
            .eq('id', id)
            .single();

        if (fErr || !imp) {
            return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
        }

        if (imp.estado !== 'pendiente_mapeo') {
            return NextResponse.json(
                { ok: false, error: `Solo se puede mapear en estado pendiente_mapeo (actual: ${imp.estado})` },
                { status: 400 }
            );
        }

        const prev: any = imp.mapeo_columnas || {};

        // Validación mínima
        if (!body.columna_codigo || !body.columna_modelo || !Array.isArray(body.precios) || body.precios.length === 0) {
            return NextResponse.json(
                { ok: false, error: 'Faltan columna_codigo, columna_modelo o al menos un precio' },
                { status: 400 }
            );
        }

        const merged = {
            ...prev, // conserva _storage_path y _bucket
            columna_codigo: body.columna_codigo,
            columna_modelo: body.columna_modelo,
            columna_marca: body.columna_marca ?? null,
            columna_descripcion: body.columna_descripcion ?? null,
            moneda_default: body.moneda_default ?? 'MXN',
            precios: body.precios, // [{columna, tipo_costo, incluye_iva}]
            columnas_a_guardar: body.columnas_a_guardar ?? [],
        };

        const { error: uErr } = await supabaseAdmin
            .from('importaciones_excel')
            .update({ 
                mapeo_columnas: merged,
                ultima_actividad: new Date().toISOString()
            })
            .eq('id', id);

        if (uErr) {
            return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, mapeo_columnas: merged });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}
