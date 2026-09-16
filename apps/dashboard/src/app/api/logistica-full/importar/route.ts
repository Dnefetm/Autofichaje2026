import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// T1 Logística Full — importa el resultado de un PDF de envío Full.
// body: { guia, items: [{ codigo_ml, unidades }] }
// Compara contra lo ya existente y detecta: nuevos, cambiados (cantidad) y quitados.
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { guia, items } = body;
        if (!guia || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json({ error: 'guia e items requeridos' }, { status: 400 });
        }

        const CAMPOS = 'egreso_id, articulo_id, cantidad, tipo_egreso, importacion_full_id, guia, transportista, operador_id, notas, fecha, largo, ancho, alto, peso, salidas_periodo, codigo_ml, edo_reunido, fecha_reunido, fecha_preparado';

        // 1. egresos existentes de la guía (por código ML)
        const { data: existentes } = await supabaseAdmin
            .from('egresos')
            .select(CAMPOS)
            .eq('tipo_egreso', 'envio_full')
            .eq('guia', String(guia));
        const porCodigo = new Map<string, any>();
        (existentes || []).forEach((e: any) => { if (e.codigo_ml) porCodigo.set(e.codigo_ml, e); });

        // cache codigo_ml -> articulo_id
        const cache = new Map<string, string | null>();
        const resolverArticulo = async (cod: string): Promise<string | null> => {
            if (cache.has(cod)) return cache.get(cod) ?? null;
            const { data: pub } = await supabaseAdmin
                .from('publicaciones_externas')
                .select('id')
                .eq('inventory_id', cod)
                .eq('external_variation_id', '0')
                .limit(1);
            const pubId = pub?.[0]?.id ?? null;
            let artId: string | null = null;
            if (pubId) {
                const { data: map } = await supabaseAdmin
                    .from('mapeo_publicacion_articulo')
                    .select('articulo_id')
                    .eq('publicacion_id', pubId)
                    .maybeSingle();
                artId = map?.articulo_id ?? null;
            }
            cache.set(cod, artId);
            return artId;
        };

        const itemsVistos = new Set<string>();
        let nuevos = 0, cambiados = 0, sinCambio = 0, quitados = 0, sinArticulo = 0;
        const detalle: { codigo_ml: string; tipo: string; antes: number | null; despues: number }[] = [];

        for (const it of items) {
            const cod = String(it.codigo_ml || '').trim();
            const uni = parseInt(String(it.unidades), 10);
            if (!cod || !Number.isFinite(uni)) continue;
            itemsVistos.add(cod);

            const artId = await resolverArticulo(cod);
            if (!artId) { sinArticulo++; continue; }

            const prev = porCodigo.get(cod);
            const egresoId = `${guia}-${cod}`;
            const tipo = !prev ? 'nuevo' : Number(prev.cantidad) !== uni ? 'cambiado' : 'sin_cambio';
            if (tipo === 'nuevo') nuevos++;
            else if (tipo === 'cambiado') cambiados++;
            else sinCambio++;
            detalle.push({ codigo_ml: cod, tipo, antes: prev ? Number(prev.cantidad) : null, despues: uni });

            const notas = tipo === 'cambiado'
                ? `[${new Date().toLocaleDateString('es-MX')}] PDF: cantidad ${Number(prev.cantidad)} → ${uni}` + (prev.notas ? ' · ' + prev.notas : '')
                : prev?.notas ?? `Importado del PDF ${guia}`;

            const { error } = await supabaseAdmin.rpc('web_upsert_egreso', {
                p_egreso_id: egresoId,
                p_articulo_id: artId,
                p_cantidad: uni,
                p_tipo_egreso: 'envio_full',
                p_importacion_full_id: prev?.importacion_full_id ?? null,
                p_guia: String(guia),
                p_transportista: prev?.transportista ?? null,
                p_operador_id: prev?.operador_id ?? null,
                p_notas: notas,
                p_fecha: prev?.fecha ?? new Date().toISOString(),
                p_largo: prev?.largo ?? null, p_ancho: prev?.ancho ?? null, p_alto: prev?.alto ?? null, p_peso: prev?.peso ?? null,
                p_salidas_periodo: prev?.salidas_periodo ?? null,
                p_codigo_ml: cod,
                p_edo_reunido: prev?.edo_reunido ?? null,
                p_fecha_reunido: prev?.fecha_reunido ?? null,
                p_fecha_preparado: prev?.fecha_preparado ?? null,
            });
            if (error) continue;
        }

        // 2. quitados: existentes que ya no están en el PDF
        for (const [cod, prev] of porCodigo) {
            if (itemsVistos.has(cod)) continue;
            quitados++;
            detalle.push({ codigo_ml: cod, tipo: 'quitado', antes: Number(prev.cantidad), despues: 0 });
            const { error } = await supabaseAdmin.rpc('web_upsert_egreso', {
                p_egreso_id: prev.egreso_id,
                p_articulo_id: prev.articulo_id,
                p_cantidad: 0,
                p_tipo_egreso: 'envio_full',
                p_importacion_full_id: prev.importacion_full_id,
                p_guia: prev.guia,
                p_transportista: prev.transportista,
                p_operador_id: prev.operador_id,
                p_notas: `[${new Date().toLocaleDateString('es-MX')}] quitado del envío (ya no está en el PDF)` + (prev.notas ? ' · ' + prev.notas : ''),
                p_fecha: prev.fecha,
                p_largo: prev.largo, p_ancho: prev.ancho, p_alto: prev.alto, p_peso: prev.peso,
                p_salidas_periodo: prev.salidas_periodo,
                p_codigo_ml: prev.codigo_ml,
                p_edo_reunido: prev.edo_reunido,
                p_fecha_reunido: prev.fecha_reunido,
                p_fecha_preparado: prev.fecha_preparado,
            });
            if (error) continue;
        }

        return NextResponse.json({
            success: true, guia,
            resumen: { nuevos, cambiados, sin_cambio: sinCambio, quitados, sin_articulo: sinArticulo },
            detalle,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error importando PDF' }, { status: 500 });
    }
}
