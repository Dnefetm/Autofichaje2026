import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Recibe un PDF de envío Full en base64, lo parsea y genera las salidas.
// body: { pdfBase64 } → devuelve { guia, items, resumen }.
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { pdfBase64 } = body;
        if (!pdfBase64) return NextResponse.json({ error: 'pdfBase64 requerido' }, { status: 400 });

        // Extraer texto del PDF (sin dependencia externa: el PDF de MeLi es texto plano en content streams).
        const text = extraerTextoPdf(pdfBase64);
        const parseado = parsearPdf(text);
        if (!parseado) return NextResponse.json({ error: 'No se pudo interpretar el PDF' }, { status: 422 });

        const { guia, items, total_productos, total_unidades } = parseado;

        // P4: avisos de ML + totales del envío (para distinguir unidades ML vs piezas).
        const avisos = {
            etiquetado: /etiquet/i.test(text),
            fragil: /burbuja|fr[áa]gil/i.test(text),
            vencimiento: /vencimiento/i.test(text),
            peso_medidas: /peso|medida|dimensi/i.test(text),
            total_productos,
            total_unidades,
        };

        // --- Generar salidas (misma lógica que /importar) ---
        const CAMPOS = 'egreso_id, articulo_id, cantidad, tipo_egreso, importacion_full_id, guia, transportista, operador_id, notas, fecha, largo, ancho, alto, peso, salidas_periodo, codigo_ml, edo_reunido, fecha_reunido, fecha_preparado';
        const { data: existentes } = await supabaseAdmin
            .from('egresos')
            .select(CAMPOS)
            .eq('tipo_egreso', 'envio_full')
            .eq('guia', String(guia));
        const porEgresoId = new Map<string, any>();
        (existentes || []).forEach((e: any) => porEgresoId.set(e.egreso_id, e));

        let totalSalidas = 0;
        const creados = new Set<string>();
        const vistos = new Set<string>();
        const cambios = new Set<string>();

        for (const it of items) {
            const cod = String(it.codigo_ml).trim();
            const unidades = parseInt(String(it.unidades), 10);
            if (!cod || !Number.isFinite(unidades)) continue;

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
                for (const m of mapeos) {
                    const objetivo = unidades * Number(m.cantidad_requerida || 1);
                    await upsertSalida({ guia, codigo_ml: cod, articulo_id: m.articulo_id, objetivo, codigo_universal: it.codigo_universal, sku: it.sku, titulo: it.titulo, porEgresoId, creados, vistos, cambios });
                    totalSalidas++;
                }
            } else {
                const { data: arts } = await supabaseAdmin
                    .from('articulos')
                    .select('articulo_id')
                    .contains('codigos_marketplace', [cod]);
                for (const a of (arts || [])) {
                    await upsertSalida({ guia, codigo_ml: cod, articulo_id: a.articulo_id, objetivo: null, codigo_universal: it.codigo_universal, sku: it.sku, titulo: it.titulo, porEgresoId, creados, vistos, cambios });
                    totalSalidas++;
                }
            }
        }

        // P3: detección de cambios (quitados = existentes que ya no vienen en el PDF)
        const quitados: string[] = [];
        for (const egresoId of porEgresoId.keys()) {
            if (!vistos.has(egresoId)) quitados.push(egresoId);
        }

        // P4: guardar avisos en todos los egresos del envío
        await supabaseAdmin.from('egresos').update({ avisos }).eq('tipo_egreso', 'envio_full').eq('guia', String(guia));

        return NextResponse.json({
            success: true,
            guia,
            items: items.length,
            salidas_generadas: totalSalidas,
            nuevas: creados.size,
            quitadas: quitados.length,
            con_cambio: cambios.size,
            quitados,
            avisos,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error importando PDF' }, { status: 500 });
    }
}

function parsearPdf(text: string): { guia: string; total_productos: number | null; total_unidades: number | null; items: { codigo_ml: string; unidades: number; codigo_universal: string | null; sku: string | null; titulo: string | null }[] } | null {
    const guia = (text.match(/Envío #(\d+)/) || [])[1];
    if (!guia) return null;
    const tot = (text.match(/Productos del envío:\s*(\d+)\s*\|\s*Total de unidades:\s*(\d+)/) || []);
    const codigos = [...text.matchAll(/Código ML:\s*(\S+)/g)].map(m => m[1]);
    const universales = [...text.matchAll(/Código universal:\s*(\S+)/g)].map(m => m[1]);
    const skus = [...text.matchAll(/SKU:\s*([^\n]+)/g)].map(m => m[1].trim());

    // Título del envío: texto entre la línea "SKU:" y "Etiquetado" en cada bloque.
    const titulos: string[] = [];
    const bloques = text.split(/Código ML:/);
    for (let i = 1; i < bloques.length; i++) {
        const b = bloques[i];
        const skuIdx = b.indexOf('SKU:');
        const etiqIdx = b.indexOf('Etiquetado');
        if (skuIdx === -1 || etiqIdx === -1) { titulos.push(''); continue; }
        const finLineaSku = b.indexOf('\n', skuIdx);
        const seccion = finLineaSku !== -1 ? b.slice(finLineaSku + 1, etiqIdx) : '';
        titulos.push(seccion.replace(/\s+/g, ' ').trim());
    }
    const unidades: number[] = [];
    const pages = text.split(/--\s*\d+\s+of\s+\d+\s*--/);
    for (const page of pages) {
        const idx = page.indexOf('PRODUCTO UNIDADES');
        if (idx === -1) continue;
        const tabla = page.slice(idx);
        for (const ln of tabla.split(/\r?\n/)) {
            if (/^\s*\d{1,4}(\s+[•·]|$)/.test(ln) && !/Código|SKU|PRODUCTO|UNIDADES|IDENTIFICACIÓN|INSTRUCCIONES/.test(ln)) {
                const m = ln.match(/^\s*(\d{1,4})/);
                if (m) unidades.push(parseInt(m[1], 10));
            }
        }
    }
    if (codigos.length === 0) return null;
    const items = [];
    for (let i = 0; i < codigos.length; i++) {
        items.push({ codigo_ml: codigos[i], unidades: unidades[i] ?? 0, codigo_universal: universales[i] || null, sku: skus[i] || null, titulo: titulos[i] || null });
    }
    return { guia, total_productos: tot[1] ? parseInt(tot[1], 10) : null, total_unidades: tot[2] ? parseInt(tot[2], 10) : null, items };
}

// Extrae texto plano de un PDF (content streams) sin dependencias externas.
function extraerTextoPdf(base64: string): string {
    const buf = Buffer.from(base64, 'base64');
    const chunks: string[] = [];
    const data = buf.toString('latin1');
    const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m: RegExpExecArray | null;
    while ((m = streamRe.exec(data)) !== null) {
        chunks.push(m[1]);
    }
    return chunks.join('\n');
}

async function upsertSalida({ guia, codigo_ml, articulo_id, objetivo, codigo_universal, sku, titulo, porEgresoId, creados, vistos, cambios }: any) {
    const egresoId = `${guia}-${codigo_ml}-${articulo_id}`;
    const prev = porEgresoId.get(egresoId);
    vistos.add(egresoId);

    // Detectar cambio de objetivo (el PDF cambió la cantidad esperada)
    if (prev && objetivo != null) {
        const m = String(prev.notas || '').match(/Objetivo:\s*(\d+)/);
        const oldObjetivo = m ? parseInt(m[1], 10) : null;
        if (oldObjetivo != null && oldObjetivo !== objetivo) cambios.add(egresoId);
    }

    const notas = objetivo != null ? `Objetivo: ${objetivo} piezas` : `Sin mapeo (código ${codigo_ml}): cantidad manual`;
    const { error } = await supabaseAdmin.rpc('web_upsert_egreso', {
        p_egreso_id: egresoId,
        p_articulo_id: articulo_id,
        p_cantidad: prev ? prev.cantidad : 0,
        p_tipo_egreso: 'envio_full',
        p_importacion_full_id: prev?.importacion_full_id ?? null,
        p_guia: guia,
        p_transportista: prev?.transportista ?? null,
        p_operador_id: prev?.operador_id ?? null,
        p_notas: notas,
        p_fecha: prev?.fecha ?? new Date().toISOString(),
        p_largo: prev?.largo ?? null, p_ancho: prev?.ancho ?? null, p_alto: prev?.alto ?? null, p_peso: prev?.peso ?? null,
        p_salidas_periodo: prev?.salidas_periodo ?? null,
        p_codigo_ml: codigo_ml,
        p_edo_reunido: prev?.edo_reunido ?? null,
        p_fecha_reunido: prev?.fecha_reunido ?? null,
        p_fecha_preparado: prev?.fecha_preparado ?? null,
    });
    if (!error) creados.add(egresoId);

    // UPC / SKU / título — el RPC no los maneja; se actualizan directo.
    const extras: Record<string, string> = {};
    if (codigo_universal) extras.codigo_universal = codigo_universal;
    if (sku) extras.sku_ml = sku;
    if (titulo) extras.titulo_ml = titulo;
    if (Object.keys(extras).length) {
        await supabaseAdmin.from('egresos').update(extras).eq('egreso_id', egresoId);
    }
}
