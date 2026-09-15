import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// T1 Logística Full — importa el resultado de un PDF de envío Full.
// body: { guia, items: [{ codigo_ml, unidades }] }
// Crea/actualiza egresos (tipo_egreso='envio_full') por código ML, mapeando a artículo.
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { guia, items } = body;
        if (!guia || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'guia e items requeridos' }, { status: 400 });
        }

        // cache codigo_ml -> articulo_id
        const cache = new Map<string, string | null>();
        let creados = 0, actualizados = 0, sinArticulo = 0;

        for (const it of items) {
            const cod = String(it.codigo_ml || '').trim();
            const uni = parseInt(String(it.unidades), 10);
            if (!cod || !Number.isFinite(uni)) continue;

            let artId: string | null;
            if (cache.has(cod)) {
                artId = cache.get(cod) ?? null;
            } else {
                const { data: pub } = await supabaseAdmin
                    .from('publicaciones_externas')
                    .select('id')
                    .eq('inventory_id', cod)
                    .eq('external_variation_id', '0')
                    .limit(1);
                const pubId = pub?.[0]?.id ?? null;
                if (pubId) {
                    const { data: map } = await supabaseAdmin
                        .from('mapeo_publicacion_articulo')
                        .select('articulo_id')
                        .eq('publicacion_id', pubId)
                        .maybeSingle();
                    artId = map?.articulo_id ?? null;
                } else {
                    artId = null;
                }
                cache.set(cod, artId);
            }
            if (!artId) { sinArticulo++; continue; }

            const egresoId = `${guia}-${cod}`;
            const { data: existing } = await supabaseAdmin
                .from('egresos')
                .select('id')
                .eq('egreso_id', egresoId)
                .maybeSingle();

            const { error } = await supabaseAdmin.rpc('web_upsert_egreso', {
                p_egreso_id: egresoId,
                p_articulo_id: artId,
                p_cantidad: uni,
                p_tipo_egreso: 'envio_full',
                p_importacion_full_id: null,
                p_guia: String(guia),
                p_transportista: null,
                p_operador_id: null,
                p_notas: existing ? `PDF reimportado: ${uni} uds.` : `Importado del PDF ${guia}`,
                p_fecha: new Date().toISOString(),
                p_largo: null, p_ancho: null, p_alto: null, p_peso: null,
                p_salidas_periodo: null,
                p_codigo_ml: cod,
                p_edo_reunido: null,
                p_fecha_reunido: null,
                p_fecha_preparado: null,
            });
            if (error) continue;
            if (existing) actualizados++; else creados++;
        }

        return NextResponse.json({ success: true, guia, items: items.length, creados, actualizados, sin_articulo: sinArticulo });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error importando PDF' }, { status: 500 });
    }
}
