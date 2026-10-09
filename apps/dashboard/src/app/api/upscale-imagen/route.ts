import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * POST /api/upscale-imagen
 * Recibe un archivo (multipart, campo "file") y lo REESCALA con sharp (Lanczos3)
 * para cumplir el mínimo de MeLi (lado mayor >= 600px, menor >= 250px).
 * Devuelve la URL pública de la imagen ampliada.
 *
 * IMPORTANTE: ampliar una imagen pequeña SIEMPRE pierde nitidez (no se puede
 * inventar detalle). Es un último recurso; lo ideal es subir una imagen de
 * >= 500px de resolución original.
 */
const BUCKET = 'ficha-imagenes';

export async function POST(req: NextRequest) {
    try {
        const form = await req.formData();
        const file = form.get('file') as File | null;
        if (!file) return NextResponse.json({ ok: false, error: 'No se recibió archivo' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const meta = await sharp(buffer).metadata();
        const w = meta.width || 0;
        const h = meta.height || 0;
        if (!w || !h) return NextResponse.json({ ok: false, error: 'Imagen inválida' }, { status: 400 });

        const scale = Math.max(600 / Math.max(w, h), 250 / Math.min(w, h), 1);
        if (scale <= 1) return NextResponse.json({ ok: false, error: 'La imagen ya cumple el tamaño mínimo' }, { status: 400 });

        const out = await sharp(buffer)
            .resize(Math.round(w * scale), Math.round(h * scale), { kernel: 'lanczos3', fit: 'fill' })
            .jpeg({ quality: 92 })
            .toBuffer();

        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );
        const filename = `mejoras/upscale_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error: uploadErr } = await supabase.storage
            .from(BUCKET)
            .upload(filename, out, { contentType: 'image/jpeg', upsert: false });
        if (uploadErr) return NextResponse.json({ ok: false, error: uploadErr.message }, { status: 500 });

        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filename}`;
        return NextResponse.json({ ok: true, url });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message || 'Error al agrandar la imagen' }, { status: 500 });
    }
}
