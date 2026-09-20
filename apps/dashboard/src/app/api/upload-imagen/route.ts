import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

/**
 * POST /api/upload-imagen
 *
 * Sube una imagen (multipart/form-data, campo "file") a Supabase Storage y
 * devuelve su URL pública. Usado por el modal "Mejorar publicación" para
 * agregar imágenes desde archivo (no solo por URL).
 *
 * Bucket: 'ficha-imagenes' (público, ya existente). Carpeta: mejoras/.
 */
const BUCKET = 'ficha-imagenes';
const MAX_BYTES = 8_000_000; // 8 MB
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

export async function POST(req: NextRequest) {
    try {
        const contentType = req.headers.get('content-type') || '';
        if (!contentType.includes('multipart/form-data')) {
            return NextResponse.json({ ok: false, error: 'Usa multipart/form-data con el campo "file"' }, { status: 400 });
        }

        const form = await req.formData();
        const file = form.get('file') as File | null;
        if (!file) return NextResponse.json({ ok: false, error: 'No se recibió archivo' }, { status: 400 });
        if (!ALLOWED_MIME.includes(file.type)) return NextResponse.json({ ok: false, error: `Formato no soportado: ${file.type}` }, { status: 400 });
        if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Archivo demasiado grande (máx 8 MB)' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        );

        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const filename = `mejoras/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadErr } = await supabase.storage
            .from(BUCKET)
            .upload(filename, buffer, { contentType: file.type || 'image/jpeg', upsert: false });

        if (uploadErr) return NextResponse.json({ ok: false, error: uploadErr.message }, { status: 500 });

        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filename}`;
        return NextResponse.json({ ok: true, url });
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message || 'Error subiendo imagen' }, { status: 500 });
    }
}
