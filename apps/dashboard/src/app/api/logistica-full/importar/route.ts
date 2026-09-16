import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// T1 Manejo Full — genera las SALIDAS (egresos) desde un PDF de envío Full.
// body: { guia, items: [{ codigo_ml, unidades }] }
// Por cada código ML, desagrega a productos de catálogo:
//   - Con MAPEO: salida por artículo con objetivo = unidades × cantidad_requerida.
//   - Sin MAPEO: salida por cada artículo cuyo codigos_marketplace contenga el código ML.
// La salida empieza en cantidad 0 (el operario la edita al valor real = descuento).
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { guia, items } = body;
        if (!guia || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'guia e items requeridos' }, { status: 400 });
        }

        const CAMPOS = 'egreso_id, articulo_id, cantidad, tipo_egreso, importacion_full_id, guia, transportista, operador_id, notas, fecha, largo, ancho, alto, peso, salidas_periodo, codigo_ml, edo_reunido, fecha_reunido, fecha_preparado';

        const { data: existentes } = await supabaseAdmin
            .from('egresos')
            .select(CAMPOS)
            .eq('tipo_egreso', 'envio_full')
            .eq('guia', String(guia));
        const porEgresoId = new Map<string, any>();
        (existentes || []).forEach((e: any) => porEgresoId.set(e.egreso_id, e));

        const creados = new Set<string>();
        let totalSalidas = 0;

        for (const it of items) {
            const cod = String(it.codigo_ml || '').trim();
            const unidades = parseInt(String(it.unidades), 10);
            if (!cod || !Number.isFinite(unidades)) continue;

            // 1. Mapeo: publicaciones con ese código ML → artículos + cantidad_requerida.
            const { data: pubs } = await supabaseAdmin
                .from('publicaciones_externas')
                .select('id')
                .eq('inventory_id', cod);
            const pubIds = (pubs || []).map((p: any) => p.id);

            let mapeos: any[] = [];
            if (pubIds.length > 0) {
                const { data: m } = await supabaseAdmin
                    .from('mapeo_publicacion_articulo')
                    .select('articulo_id, cantidad_requerida')
                    .in('publicacion_id', pubIds);
                mapeos = m || [];
            }

            if (mapeos.length > 0) {
                // Con mapeo: objetivo exacto por artículo.
                for (const m of mapeos) {
                    const objetivo = unidades * Number(m.cantidad_requerida || 1);
                    await upsertSalida({
                        guia: String(guia),
                        codigo_ml: cod,
                        articulo_id: m.articulo_id,
                        objetivo,
                        porEgresoId,
                        creados,
                    });
                    totalSalidas++;
                }
            } else {
                // Sin mapeo: artículos cuyo codigos_marketplace contiene el código.
                const { data: arts } = await supabaseAdmin
                    .from('articulos')
                    .select('articulo_id')
                    .contains('codigos_marketplace', [cod]);
                for (const a of (arts || [])) {
                    await upsertSalida({
                        guia: String(guia),
                        codigo_ml: cod,
                        articulo_id: a.articulo_id,
                        objetivo: null,
                        porEgresoId,
                        creados,
                    });
                    totalSalidas++;
                }
            }
        }

        return NextResponse.json({
            success: true,
            guia,
            items_pdf: items.length,
            salidas_generadas: totalSalidas,
            nuevas: creados.size,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error generando salidas' }, { status: 500 });
    }
}

async function upsertSalida({ guia, codigo_ml, articulo_id, objetivo, porEgresoId, creados }: {
    guia: string;
    codigo_ml: string;
    articulo_id: string;
    objetivo: number | null;
    porEgresoId: Map<string, any>;
    creados: Set<string>;
}) {
    const egresoId = `${guia}-${codigo_ml}-${articulo_id}`;
    const prev = porEgresoId.get(egresoId);

    const notaObjetivo = objetivo != null ? `Objetivo: ${objetivo} piezas` : `Sin mapeo (código ${codigo_ml}): cantidad manual`;
    const notas = prev?.notas && !prev.notas.includes('Objetivo:')
        ? `${notaObjetivo} · ${prev.notas}`
        : notaObjetivo;

    const { error } = await supabaseAdmin.rpc('web_upsert_egreso', {
        p_egreso_id: egresoId,
        p_articulo_id: articulo_id,
        p_cantidad: prev ? prev.cantidad : 0,   // la salida inicia en 0
        p_tipo_egreso: 'envio_full',
        p_importacion_full_id: prev?.importacion_full_id ?? null,
        p_guia: guia,
        p_transportista: prev?.transportista ?? null,
        p_operador_id: prev?.operador_id ?? null,
        p_notas: notas,
        p_fecha: prev?.fecha ?? new Date().toISOString(),
        p_largo: prev?.largo ?? null,
        p_ancho: prev?.ancho ?? null,
        p_alto: prev?.alto ?? null,
        p_peso: prev?.peso ?? null,
        p_salidas_periodo: prev?.salidas_periodo ?? null,
        p_codigo_ml: codigo_ml,
        p_edo_reunido: prev?.edo_reunido ?? null,
        p_fecha_reunido: prev?.fecha_reunido ?? null,
        p_fecha_preparado: prev?.fecha_preparado ?? null,
    });
    if (error) return;
    creados.add(egresoId);
}
