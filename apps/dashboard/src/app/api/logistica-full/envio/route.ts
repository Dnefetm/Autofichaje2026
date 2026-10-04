import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CAMPOS_EGRESO = 'id, egreso_id, articulo_id, cantidad, tipo_egreso, importacion_full_id, guia, transportista, operador_id, notas, fecha, largo, ancho, alto, peso, salidas_periodo, codigo_ml, edo_reunido, fecha_reunido, fecha_preparado, fecha_cerrado, avisos, imagenes, codigo_universal, sku_ml, titulo_ml';

// GET /api/logistica-full/envio?guia=X — detalle de un envío Full (egresos + nombre de artículo).
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const guia = searchParams.get('guia');
    if (!guia) return NextResponse.json({ error: 'guia requerido' }, { status: 400 });

    const { data: egresos, error } = await supabaseAdmin
        .from('egresos')
        .select(`${CAMPOS_EGRESO}`)
        .eq('tipo_egreso', 'envio_full')
        .eq('guia', guia)
        .order('articulo_id');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Nombres, ubicación, peso, medidas y atributos de artículos.
    const infoArticulo = new Map<string, any>();
    const ids = [...new Set((egresos || []).map(e => e.articulo_id))];
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { data: arts } = await supabaseAdmin
            .from('articulos')
            .select('articulo_id, nombre, marca, modelo, caja_madre, peso_kg, largo_cm, ancho_cm, alto_cm, atributos_especificos')
            .in('articulo_id', chunk);
        (arts || []).forEach(a => infoArticulo.set(a.articulo_id, a));
    }

    // Foto + stock + urgencia de la vitrina (por código ML → inventory_id).
    const infoPublicacion = new Map<string, any>();
    const codigos = [...new Set((egresos || []).map(e => e.codigo_ml).filter(Boolean))];
    for (let i = 0; i < codigos.length; i += 100) {
        const chunk = codigos.slice(i, i + 100);
        const { data: pubs } = await supabaseAdmin
            .from('publicaciones_externas')
            .select('inventory_id, url_imagen, titulo, seller_sku, stock_full, replenishment_suggested')
            .in('inventory_id', chunk)
            .eq('external_variation_id', '0');
        (pubs || []).forEach(p => { if (!infoPublicacion.has(p.inventory_id)) infoPublicacion.set(p.inventory_id, p); });
    }

    return NextResponse.json({
        success: true,
        guia,
        count: (egresos || []).length,
        egresos: (egresos || []).map(e => {
            const art = infoArticulo.get(e.articulo_id);
            const pub = infoPublicacion.get(e.codigo_ml);
            return {
                ...e,
                nombre: art?.nombre || null,
                marca: art?.marca || null,
                modelo: art?.modelo || null,
                titulo_ml: e.titulo_ml || pub?.titulo || null,
                sku_ml: e.sku_ml || pub?.seller_sku || null,
                ubicacion: art?.caja_madre || null,
                peso_kg: art?.peso_kg ?? null,
                largo_cm: art?.largo_cm ?? null,
                ancho_cm: art?.ancho_cm ?? null,
                alto_cm: art?.alto_cm ?? null,
                atributos: art?.atributos_especificos ?? null,
                foto: pub?.url_imagen || null,
                stock_full: pub?.stock_full ?? null,
                sugerencia_ml: pub?.replenishment_suggested ?? null,
            };
        }),
    });
}

// POST /api/logistica-full/envio — avanza el estado de un envío completo.
// body: { guia, accion: 'reunir' | 'preparar' }
// Usa web_upsert_egreso (preserva todos los campos y sincroniza a Sheets vía outbox).
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { guia, accion } = body;
        if (!guia || !accion) return NextResponse.json({ error: 'guia y accion requeridos' }, { status: 400 });

        const { data: egresos, error } = await supabaseAdmin
            .from('egresos')
            .select(`${CAMPOS_EGRESO}`)
            .eq('tipo_egreso', 'envio_full')
            .eq('guia', guia);

        if (error) throw error;

        const now = new Date().toISOString();
        const nuevoEdo = accion === 'preparar' ? 'Preparado' : 'Reunido';
        let updated = 0;
        let errors = 0;

        for (const e of (egresos || [])) {
            const { error: rpcErr } = await supabaseAdmin.rpc('web_upsert_egreso', {
                p_egreso_id: e.egreso_id,
                p_articulo_id: e.articulo_id,
                p_cantidad: e.cantidad,
                p_tipo_egreso: 'envio_full',
                p_importacion_full_id: e.importacion_full_id,
                p_guia: e.guia,
                p_transportista: e.transportista,
                p_operador_id: e.operador_id,
                p_notas: e.notas,
                p_fecha: e.fecha,
                p_largo: e.largo,
                p_ancho: e.ancho,
                p_alto: e.alto,
                p_peso: e.peso,
                p_salidas_periodo: e.salidas_periodo,
                p_codigo_ml: e.codigo_ml,
                p_edo_reunido: nuevoEdo,
                p_fecha_reunido: accion === 'reunir' ? now : e.fecha_reunido,
                p_fecha_preparado: accion === 'preparar' ? now : e.fecha_preparado,
            });
            if (rpcErr) errors++; else updated++;
        }

        return NextResponse.json({ success: true, updated, errors });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error avanzando estado' }, { status: 500 });
    }
}

// PATCH /api/logistica-full/envio — edita UN producto del envío (cantidad y/o estado).
// body: { egreso_id, cantidad?, accion?: 'reunir' | 'preparar' | 'quitar' }
// El estado se marca/quita POR PRODUCTO (no por guía). "quitar" retrocede un paso.
export async function PATCH(req: Request) {
    try {
        const body = await req.json();
        const { egreso_id, cantidad, accion, notas, imagenes, nueva_imagen } = body;
        if (!egreso_id) return NextResponse.json({ error: 'egreso_id requerido' }, { status: 400 });

        const { data: eg, error } = await supabaseAdmin
            .from('egresos')
            .select(`${CAMPOS_EGRESO}`)
            .eq('egreso_id', egreso_id)
            .maybeSingle();
        if (error) throw error;
        if (!eg) return NextResponse.json({ error: 'egreso no encontrado' }, { status: 404 });

        let nuevaCantidad = eg.cantidad;
        if (cantidad != null) {
            const n = Number(cantidad);
            if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: 'cantidad inválida' }, { status: 400 });
            nuevaCantidad = n;
        }

        let edo = eg.edo_reunido;
        let fReunido = eg.fecha_reunido;
        let fPreparado = eg.fecha_preparado;
        let fCerrado = eg.fecha_cerrado;
        const now = new Date().toISOString();
        const log: string[] = [];

        if (accion === 'reunir') {
            edo = 'Reunido'; fReunido = now; fPreparado = null; log.push('reunido');
        } else if (accion === 'preparar') {
            edo = 'Preparado'; if (!fReunido) fReunido = now; fPreparado = now; log.push('preparado');
        } else if (accion === 'quitar') {
            if (edo === 'Preparado') { edo = 'Reunido'; fPreparado = null; log.push('quitado preparado'); }
            else if (edo === 'Reunido') { edo = null; fReunido = null; log.push('quitado reunido'); }
        } else if (accion === 'cerrar') {
            edo = 'Cerrado'; fCerrado = now; log.push('cerrado');
        }

        const original = Number(eg.cantidad || 0);
        if (cantidad != null && Number(cantidad) !== original) {
            log.push(`cantidad ${original} → ${Number(cantidad)}`);
        }

        const stamp = `[${new Date().toLocaleDateString('es-MX')}]`;
        let notasFinal = log.length > 0
            ? `${stamp} ${log.join('; ')}` + (eg.notas ? ' · ' + eg.notas : '')
            : eg.notas;
        // Nota libre del operario (se antepone, no pisa el histórico)
        if (typeof notas === 'string' && notas.trim()) {
            notasFinal = `${stamp} ${notas.trim()}` + (notasFinal ? ' · ' + notasFinal : '');
        }

        const { error: rpcErr } = await supabaseAdmin.rpc('web_upsert_egreso', {
            p_egreso_id: eg.egreso_id,
            p_articulo_id: eg.articulo_id,
            p_cantidad: nuevaCantidad,
            p_tipo_egreso: 'envio_full',
            p_importacion_full_id: eg.importacion_full_id,
            p_guia: eg.guia,
            p_transportista: eg.transportista,
            p_operador_id: eg.operador_id,
            p_notas: notasFinal,
            p_fecha: eg.fecha,
            p_largo: eg.largo,
            p_ancho: eg.ancho,
            p_alto: eg.alto,
            p_peso: eg.peso,
            p_salidas_periodo: eg.salidas_periodo,
            p_codigo_ml: eg.codigo_ml,
            p_edo_reunido: edo,
            p_fecha_reunido: fReunido,
            p_fecha_preparado: fPreparado,
        });
        if (rpcErr) throw rpcErr;

        // Fotos (imagenes) — el RPC no las maneja; se actualizan directo.
        if (Array.isArray(imagenes)) {
            await supabaseAdmin.from('egresos').update({ imagenes }).eq('egreso_id', eg.egreso_id);
        }

        // P5: subir nueva imagen a Storage (URL en vez de base64).
        if (nueva_imagen?.base64) {
            try {
                const b64 = String(nueva_imagen.base64);
                const mime = nueva_imagen.mime || 'image/jpeg';
                const ext = mime.split('/')[1] || 'jpg';
                const path = `${eg.egreso_id}/${Date.now()}.${ext}`;
                const buf = Buffer.from(b64, 'base64');
                const { error: upErr } = await supabaseAdmin.storage
                    .from('fotos-egresos')
                    .upload(path, buf, { contentType: mime });
                if (!upErr) {
                    const { data: pub } = supabaseAdmin.storage.from('fotos-egresos').getPublicUrl(path);
                    const actuales = Array.isArray(eg.imagenes) ? eg.imagenes : [];
                    await supabaseAdmin.from('egresos').update({ imagenes: [...actuales, pub.publicUrl] }).eq('egreso_id', eg.egreso_id);
                }
            } catch (_) { /* falla de subida: no romper el flujo */ }
        }

        // fecha_cerrado — el RPC no la maneja; se actualiza directo.
        if (accion === 'cerrar') {
            await supabaseAdmin.from('egresos').update({ fecha_cerrado: fCerrado }).eq('egreso_id', eg.egreso_id);
        }

        return NextResponse.json({ success: true, edo, notas: notasFinal });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error editando producto' }, { status: 500 });
    }
}
