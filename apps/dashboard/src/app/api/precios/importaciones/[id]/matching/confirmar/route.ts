import { friendlyError } from '@/lib/friendlyError';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await props.params;

        // 1. Obtener la importación y la lista oficial para este proveedor
        const { data: imp, error: fetchErr } = await supabaseAdmin
            .from('importaciones_excel')
            .select('proveedor, tipo_costo_default, estado, mapeo_columnas')
            .eq('id', id)
            .single();

        if (fetchErr || !imp) {
            return NextResponse.json({ ok: false, error: 'Importación no encontrada' }, { status: 404 });
        }

        // 2. Obtener todas las filas de matching_decisiones confirmadas para esta importación
        const { data: decisiones, error: decErr } = await supabaseAdmin
            .from('matching_decisiones')
            .select('cand_articulo_id, articulo_id_final, pct, codigo_universal_excel, marca_excel, modelo_excel, nombre_excel, proveedor')
            .eq('importacion_id', id)
            .eq('confirmado', true)
            .not('articulo_id_final', 'is', null);

        if (decErr) {
            return NextResponse.json({ ok: false, error: 'Error leyendo decisiones: ' + decErr.message }, { status: 500 });
        }

        if (!decisiones || decisiones.length === 0) {
            return NextResponse.json({ ok: false, error: 'No hay filas confirmadas para consolidar' }, { status: 400 });
        }

        // Ya que necesitamos el precio, debemos cruzar con listas_precios_raw.
        // Pero espera, matching_decisiones no guarda el ID de raw ni la fila_num (según el schema).
        // Si no tenemos el precio ni la fila, ¿cómo guardamos el costo?
        // Tenemos el proveedor, marca, modelo, codigo.
        // Lo ideal es invocar un RPC para hacer esta consolidación de forma atómica y segura en BD.

        const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('fn_consolidar_matching_decisiones', {
            p_importacion_id: id,
            p_proveedor: imp.proveedor,
            p_tipo_costo: imp.tipo_costo_default
        });

        if (rpcErr) {
            // Si no existe la función, la crearemos o haremos el cruce aquí
            console.error("Error en RPC de consolidación:", rpcErr);
            return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
        }

        // Actualizar estado de importación
        await supabaseAdmin.from('importaciones_excel').update({
            estado: 'completado',
            ultima_actividad: new Date().toISOString()
        }).eq('id', id);

        return NextResponse.json({ ok: true, consolidados: decisiones.length });

    } catch (e: any) {
        return NextResponse.json({ ok: false, error: friendlyError(e) }, { status: 500 });
    }
}
