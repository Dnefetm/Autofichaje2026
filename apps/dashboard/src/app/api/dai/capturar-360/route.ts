import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { extraerFrames360 } from '@/lib/dai-extractor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/dai/capturar-360  { codigo, articulo_id, angulos? }
 * Descarga los frames estáticos del visor 360 de DAI (img/N.jpg), elige N ángulos
 * equidistantes, los sube a Storage y los registra en ficha_imagenes (tipo '360').
 * NO usa navegador (es descarga HTTP directa).
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    const codigo = String(body?.codigo ?? '').trim();
    const articuloId = String(body?.articulo_id ?? '').trim();
    const angulos = Math.max(2, Math.min(12, Number(body?.angulos ?? 8)));
    if (!codigo || !articuloId) {
        return NextResponse.json({ ok: false, error: 'codigo y articulo_id requeridos' }, { status: 400 });
    }

    // 1. Frames del 360
    const frames = await extraerFrames360(codigo);
    if (frames.length === 0) {
        return NextResponse.json({ ok: false, error: `Sin vista 360 para ${codigo}` }, { status: 404 });
    }

    // 2. N ángulos equidistantes
    const step = Math.max(1, Math.floor(frames.length / angulos));
    const elegidos = frames.filter((_, i) => i % step === 0).slice(0, angulos);

    // 3. Asegurar ficha técnica
    let fichaId: string | null = null;
    const { data: ficha } = await supabaseAdmin.from('fichas_tecnicas').select('id').eq('articulo_id', articuloId).limit(1).maybeSingle();
    if (ficha) {
        fichaId = ficha.id;
    } else {
        const { data: art } = await supabaseAdmin.from('articulos').select('nombre,marca,modelo,codigo_universal').eq('articulo_id', articuloId).maybeSingle();
        const { data: nueva, error: fichaErr } = await supabaseAdmin.from('fichas_tecnicas').insert({
            articulo_id: articuloId,
            nombre_producto: art?.nombre || codigo,
            marca: art?.marca || 'DAI',
            modelo: art?.modelo || codigo,
            codigo_universal: art?.codigo_universal || null,
            estado: 'borrador',
            fecha_creacion: new Date().toISOString(),
        }).select('id').single();
        if (fichaErr || !nueva) return NextResponse.json({ ok: false, error: 'No se pudo crear la ficha' }, { status: 500 });
        fichaId = nueva.id;
    }

    // 4. Descargar + subir + registrar
    const bucket = 'ficha-imagenes';
    let orden = 0;
    let capturadas = 0;
    for (const url of elegidos) {
        orden++;
        try {
            const r = await fetch(url);
            if (!r.ok) continue;
            const buf = Buffer.from(await r.arrayBuffer());
            const p = `fichas/${fichaId}/${codigo}_360_${orden}.jpg`;
            const { error: upErr } = await supabaseAdmin.storage.from(bucket).upload(p, buf, { contentType: 'image/jpeg', upsert: true });
            if (upErr) continue;
            const pub = supabaseAdmin.storage.from(bucket).getPublicUrl(p);
            await supabaseAdmin.from('ficha_imagenes').insert({
                ficha_id: fichaId,
                url: pub.data.publicUrl,
                storage_path: p,
                orden,
                tipo: '360',
                formato: 'jpg',
                fuente: 'dai_360',
                url_original: url,
            });
            capturadas++;
        } catch { /* skip frame */ }
    }

    return NextResponse.json({ ok: true, capturadas, frames_disponibles: frames.length, ficha_id: fichaId });
}
