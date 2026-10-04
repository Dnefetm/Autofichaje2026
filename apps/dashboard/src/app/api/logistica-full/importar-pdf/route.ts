import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Recibe un PDF de envío Full en base64, lo parsea y genera las salidas.
// body: { pdfBase64 } → devuelve { guia, items, resumen }.
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { pdfBase64 } = body;
        if (!pdfBase64) return NextResponse.json({ error: 'pdfBase64 requerido' }, { status: 400 });

        // Extraer texto del PDF (FlateDecode: requiere descompresión real, no lectura cruda).
        const text = await extraerTextoPdf(pdfBase64);
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
        const CAMPOS = 'egreso_id, articulo_id, cantidad, tipo_egreso, importacion_full_id, guia, transportista, operador_id, notas, fecha, largo, ancho, alto, peso, salidas_periodo, codigo_ml, edo_reunido, fecha_reunido, fecha_preparado, objetivo';
        const { data: existentes } = await supabaseAdmin
            .from('egresos')
            .select(CAMPOS)
            .eq('tipo_egreso', 'envio_full')
            .eq('guia', String(guia));
        const porEgresoId = new Map<string, any>();
        (existentes || []).forEach((e: any) => porEgresoId.set(e.egreso_id, e));

        // Precarga (1 consulta por tabla en lotes de 100, en vez de 1 por producto):
        // la importación con 255 productos hacía ~1000 round-trips y reventaba el timeout.
        const codigos = items.map(it => String(it.codigo_ml).trim()).filter(Boolean);
        const pubPorCodigo = new Map<string, string[]>();
        for (let i = 0; i < codigos.length; i += 100) {
            const chunk = codigos.slice(i, i + 100);
            const { data: pubs } = await supabaseAdmin
                .from('publicaciones_externas')
                .select('id, inventory_id')
                .in('inventory_id', chunk);
            for (const p of (pubs || [])) {
                if (!pubPorCodigo.has(p.inventory_id)) pubPorCodigo.set(p.inventory_id, []);
                pubPorCodigo.get(p.inventory_id)!.push(p.id);
            }
        }
        const todosPubIds = [...new Set([...pubPorCodigo.values()].flat())];
        const mapeoPorPublicacion = new Map<string, any[]>();
        for (let i = 0; i < todosPubIds.length; i += 100) {
            const chunk = todosPubIds.slice(i, i + 100);
            const { data: m } = await supabaseAdmin
                .from('mapeo_publicacion_articulo')
                .select('publicacion_id, articulo_id, cantidad_requerida')
                .in('publicacion_id', chunk);
            for (const r of (m || [])) {
                if (!mapeoPorPublicacion.has(r.publicacion_id)) mapeoPorPublicacion.set(r.publicacion_id, []);
                mapeoPorPublicacion.get(r.publicacion_id)!.push(r);
            }
        }

        const creados = new Set<string>();
        const vistos = new Set<string>();
        const cambios = new Set<string>();
        const procesados = new Set<string>();
        const tareas: any[] = [];
        const sinMapeo: any[] = [];

        // Construir la lista de salidas (sin IO) y luego escribir en lotes concurrentes.
        for (const it of items) {
            const cod = String(it.codigo_ml).trim();
            const unidades = parseInt(String(it.unidades), 10);
            if (!cod || !Number.isFinite(unidades)) continue;

            let mapeos: any[] = [];
            for (const pid of (pubPorCodigo.get(cod) || [])) mapeos.push(...(mapeoPorPublicacion.get(pid) || []));

            if (mapeos.length > 0) {
                for (const m of mapeos) {
                    const egresoId = `${guia}-${cod}-${m.articulo_id}`;
                    if (procesados.has(egresoId)) continue;
                    procesados.add(egresoId);
                    tareas.push({ guia, codigo_ml: cod, articulo_id: m.articulo_id, objetivo: unidades * Number(m.cantidad_requerida || 1), codigo_universal: it.codigo_universal, sku: it.sku, titulo: it.titulo });
                }
            } else {
                // Artículo con el código en codigos_marketplace (vinculación 1:1).
                const artsResp = await supabaseAdmin
                    .from('articulos')
                    .select('articulo_id')
                    .contains('codigos_marketplace', [cod]);
                const arts = artsResp.data || [];
                if (arts.length > 0) {
                    for (const a of arts) {
                        const egresoId = `${guia}-${cod}-${a.articulo_id}`;
                        if (procesados.has(egresoId)) continue;
                        procesados.add(egresoId);
                        tareas.push({ guia, codigo_ml: cod, articulo_id: a.articulo_id, objetivo: unidades, codigo_universal: it.codigo_universal, sku: it.sku, titulo: it.titulo });
                    }
                } else {
                    // Sin ninguna vinculación: se reporta para mapear a mano (no se crea egreso).
                    sinMapeo.push({ codigo_ml: cod, titulo: it.titulo, sku: it.sku, unidades, tiene_vidriera: (pubPorCodigo.get(cod) || []).length > 0 });
                }
            }
        }

        let totalSalidas = tareas.length;
        const CONCURRENCIA = 8;
        let cursor = 0;
        async function worker() {
            while (cursor < tareas.length) {
                const t = tareas[cursor++];
                await upsertSalida({ ...t, porEgresoId, creados, vistos, cambios });
            }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, tareas.length) }, () => worker()));

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
            sin_mapeo: sinMapeo,
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
    const universales = [...text.matchAll(/Código universal:\s*(\S+)/g)].map(m => m[1] === 'N/A' ? null : m[1]);
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

// Extrae texto plano de un PDF usando pdf-parse (descomprime FlateDecode y
// decodifica las fuentes). El PDF de MeLi está comprimido; la lectura cruda no sirve.
async function extraerTextoPdf(base64: string): Promise<string> {
    const mod: any = await import('pdf-parse');
    const PDFParse = mod.PDFParse || mod.default?.PDFParse;
    const parser = new PDFParse({ data: Buffer.from(base64, 'base64') });
    const result = await parser.getText();
    return result.text || '';
}

async function upsertSalida({ guia, codigo_ml, articulo_id, objetivo, codigo_universal, sku, titulo, porEgresoId, creados, vistos, cambios }: any) {
    const egresoId = `${guia}-${codigo_ml}-${articulo_id}`;
    const prev = porEgresoId.get(egresoId);
    vistos.add(egresoId);

    // Detectar cambio de objetivo (el PDF cambió la cantidad esperada).
    if (prev && objetivo != null && prev.objetivo != null && prev.objetivo !== objetivo) cambios.add(egresoId);

    // Las notas son del operario: se conservan al re-importar, limpiando los mensajes
    // de sistema que antes se guardaban ahí ("Objetivo: N piezas" / "Sin mapeo…").
    const notasLimpias = prev?.notas
        ? String(prev.notas)
            .replace(/Objetivo:\s*\d+\s*piezas\s*/i, '')
            .replace(/Sin mapeo\s*\(c[óo]digo [^)]*\):\s*cantidad manual\s*/i, '')
            .trim()
        : '';
    const notas = notasLimpias || null;

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

    // UPC / SKU / título / objetivo — el RPC no los maneja; se actualizan directo
    // (siempre se escriben, incluso null, para que el PDF sea la fuente de verdad).
    const extras: Record<string, any> = {
        objetivo: objetivo ?? null,
        codigo_universal: codigo_universal ?? null,
        sku_ml: sku ?? null,
        titulo_ml: titulo ?? null,
    };
    await supabaseAdmin.from('egresos').update(extras).eq('egreso_id', egresoId);
}
