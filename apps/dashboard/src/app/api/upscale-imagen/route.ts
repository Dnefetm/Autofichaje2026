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
        let w = meta.width || 0;
        let h = meta.height || 0;
        if (!w || !h) return NextResponse.json({ ok: false, error: 'Imagen inválida' }, { status: 400 });

        // Si ya cumple el tamaño mínimo de MeLi (max >= 500 && min >= 250), no tocar nada
        if (Math.max(w, h) >= 500 && Math.min(w, h) >= 250) {
            return NextResponse.json({ ok: false, error: 'La imagen ya cumple el tamaño mínimo' }, { status: 400 });
        }

        let pipeline = sharp(buffer).flatten({ background: { r: 255, g: 255, b: 255 } });

        // Umbral: Si ambos lados son muy chicos (< 400 en su lado mayor),
        // aplicar upscale moderado (máx 1.5x) con Lanczos3 y unsharp mask suave para mantener bordes
        if (Math.max(w, h) < 400) {
            const moderateScale = Math.min(1.5, 500 / Math.max(w, h));
            const newW = Math.round(w * moderateScale);
            const newH = Math.round(h * moderateScale);
            pipeline = pipeline
                .resize(newW, newH, { kernel: 'lanczos3', fit: 'fill' })
                .sharpen({ sigma: 1.0, m1: 1.5, m2: 0.7 });
            w = newW;
            h = newH;
        }

        // Padding puro con .extend(): agrega margen blanco sin tocar ni remuestrear los píxeles originales
        const isLandscape = w >= h;
        const targetW = isLandscape ? Math.max(w, 500) : Math.max(w, 250);
        const targetH = isLandscape ? Math.max(h, 250) : Math.max(h, 500);

        const padW = Math.max(0, targetW - w);
        const padH = Math.max(0, targetH - h);

        if (padW > 0 || padH > 0) {
            const left = Math.floor(padW / 2);
            const right = padW - left;
            const top = Math.floor(padH / 2);
            const bottom = padH - top;

            pipeline = pipeline.extend({
                top,
                bottom,
                left,
                right,
                background: { r: 255, g: 255, b: 255 },
            });
        }

        const out = await pipeline
            .jpeg({ quality: 95 })
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
        return NextResponse.json({ ok: false, error: err.message || 'Error al adaptar la imagen' }, { status: 500 });
    }
}
