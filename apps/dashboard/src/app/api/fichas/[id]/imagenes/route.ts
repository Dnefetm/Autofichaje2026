import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET  /api/fichas/[id]/imagenes   — Lista imágenes de la ficha
 * POST /api/fichas/[id]/imagenes   — Guarda imagen desde URL directa o upload multipart
 *
 * Formato de guardado: WebP comprimido (máxima compresión con calidad alta).
 * Storage bucket: 'ficha-imagenes' (debe existir en Supabase Storage, público).
 */

const BUCKET = 'ficha-imagenes';
const WEBP_QUALITY = 88; // buena calidad (0-100), archivos ~3x más pequeños que JPEG
const MAX_DIMENSION = 2000; // px máximo por lado (MeLi acepta hasta 2000×2000)
const MAX_BYTES = 8_000_000; // 8 MB límite upload
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

// ── GET — Listar imágenes ────────────────────────────────────────────────────
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: fichaId } = await params;
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
        .from('ficha_imagenes')
        .select('id, url, storage_path, orden, tipo, formato, ancho_px, alto_px, tamano_bytes, fuente, url_original, created_at')
        .eq('ficha_id', fichaId)
        .order('orden', { ascending: true });

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, imagenes: data ?? [] });
}

// ── POST — Guardar imagen ────────────────────────────────────────────────────
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: fichaId } = await params;
    const supabase = getSupabaseAdmin();
    const contentType = req.headers.get('content-type') || '';

    // Verificar que la ficha existe
    const { data: ficha, error: fichaErr } = await supabase
        .from('fichas_tecnicas')
        .select('id, articulo_id')
        .eq('id', fichaId)
        .single();
    if (fichaErr || !ficha) return NextResponse.json({ ok: false, error: 'Ficha no encontrada' }, { status: 404 });

    // ── Determinar orden (siguiente disponible) ──────────────────────────────
    const { data: existentes } = await supabase
        .from('ficha_imagenes')
        .select('orden')
        .eq('ficha_id', fichaId)
        .order('orden', { ascending: false })
        .limit(1);
    const nextOrden = existentes?.[0] ? (existentes[0].orden + 1) : 0;

    // ── Caso 1: JSON con URL directa (sin Sharp, guardar referencia) ─────────
    if (contentType.includes('application/json')) {
        const body = await req.json().catch(() => null);
        if (!body?.url) return NextResponse.json({ ok: false, error: 'Se requiere "url" en el body' }, { status: 400 });

        const imagen = await processImageUrl(body.url, fichaId, ficha.articulo_id, nextOrden, body.tipo || 'producto', body.fuente || 'url_directa', supabase);
        return NextResponse.json({ ok: true, imagen });
    }

    // ── Caso 2: multipart/form-data con archivo ──────────────────────────────
    if (contentType.includes('multipart/form-data')) {
        const form = await req.formData();
        const file = form.get('file') as File | null;
        const tipo = (form.get('tipo') as string) || 'producto';
        const ordenOverride = form.get('orden') ? parseInt(form.get('orden') as string) : nextOrden;

        if (!file) return NextResponse.json({ ok: false, error: 'No se recibió archivo' }, { status: 400 });
        if (!ALLOWED_MIME.includes(file.type)) return NextResponse.json({ ok: false, error: `Formato no soportado: ${file.type}` }, { status: 400 });
        if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'Archivo demasiado grande (máx 8 MB)' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const imagen = await processImageBuffer(buffer, file.name, fichaId, ficha.articulo_id, ordenOverride, tipo, supabase);
        return NextResponse.json({ ok: true, imagen });
    }

    return NextResponse.json({ ok: false, error: 'Content-Type no soportado. Usa application/json (URL) o multipart/form-data (archivo)' }, { status: 400 });
}

// ── DELETE — Eliminar imagen ─────────────────────────────────────────────────
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: fichaId } = await params;
    const { searchParams } = new URL(req.url);
    const imagenId = searchParams.get('imagen_id');
    if (!imagenId) return NextResponse.json({ ok: false, error: 'Se requiere imagen_id' }, { status: 400 });

    const supabase = getSupabaseAdmin();
    const { data: imagen, error } = await supabase
        .from('ficha_imagenes')
        .select('id, storage_path')
        .eq('id', imagenId)
        .eq('ficha_id', fichaId)
        .single();

    if (error || !imagen) return NextResponse.json({ ok: false, error: 'Imagen no encontrada' }, { status: 404 });

    // Eliminar de Storage si tiene path
    if (imagen.storage_path) {
        await supabase.storage.from(BUCKET).remove([imagen.storage_path]);
    }

    await supabase.from('ficha_imagenes').delete().eq('id', imagenId);
    return NextResponse.json({ ok: true });
}

// ── PATCH — Reordenar imágenes ───────────────────────────────────────────────
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: fichaId } = await params;
    const body = await req.json().catch(() => null);
    // body: { ordenes: [{ id: string, orden: number }] }
    if (!body?.ordenes || !Array.isArray(body.ordenes)) {
        return NextResponse.json({ ok: false, error: 'Se requiere ordenes: [{id, orden}]' }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    for (const { id, orden } of body.ordenes) {
        await supabase.from('ficha_imagenes').update({ orden }).eq('id', id).eq('ficha_id', fichaId);
    }
    return NextResponse.json({ ok: true });
}

// ── Helper: procesar imagen desde URL ────────────────────────────────────────
async function processImageUrl(
    url: string,
    fichaId: string,
    articuloId: string | null,
    orden: number,
    tipo: string,
    fuente: string,
    supabase: ReturnType<typeof getSupabaseAdmin>,
) {
    // Descargar imagen
    const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) throw new Error(`URL respondió ${resp.status}`);
    const mimeType = resp.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    if (!ALLOWED_MIME.includes(mimeType)) throw new Error(`Formato no soportado: ${mimeType}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error('Imagen demasiado grande (máx 8 MB)');

    return processImageBuffer(buffer, url.split('/').pop()?.split('?')[0] || 'imagen', fichaId, articuloId, orden, tipo, supabase, fuente, url);
}

// ── Helper: procesar buffer → WebP → Storage ─────────────────────────────────
async function processImageBuffer(
    buffer: Buffer,
    originalName: string,
    fichaId: string,
    articuloId: string | null,
    orden: number,
    tipo: string,
    supabase: ReturnType<typeof getSupabaseAdmin>,
    fuente = 'manual',
    urlOriginal?: string,
) {
    let finalBuffer = buffer;
    let ancho: number | undefined;
    let alto: number | undefined;
    let storagePath: string | undefined;

    // Intentar conversión a WebP con Sharp si está disponible
    try {
        const sharp = (await import('sharp')).default;
        const img = sharp(buffer);
        const meta = await img.metadata();
        ancho = meta.width;
        alto = meta.height;

        // Redimensionar si excede el máximo, manteniendo proporción
        const needsResize = (ancho && ancho > MAX_DIMENSION) || (alto && alto > MAX_DIMENSION);
        let pipeline = needsResize
            ? img.resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
            : img;

        finalBuffer = await pipeline.webp({ quality: WEBP_QUALITY, effort: 6 }).toBuffer();
        const finalMeta = await sharp(finalBuffer).metadata();
        ancho = finalMeta.width;
        alto = finalMeta.height;
    } catch {
        // Sharp no disponible — usar buffer original
    }

    // Subir a Storage
    const prefix = articuloId ? `${articuloId}/` : '';
    const filename = `${prefix}${fichaId}/${orden}_${Date.now()}.webp`;
    const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(filename, finalBuffer, { contentType: 'image/webp', upsert: false });

    if (!uploadErr) {
        storagePath = filename;
    }

    // URL pública
    const publicUrl = storagePath
        ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filename}`
        : urlOriginal || '';

    // Insertar en BD
    const { data: inserted } = await supabase
        .from('ficha_imagenes')
        .insert({
            ficha_id:     fichaId,
            url:          publicUrl,
            storage_path: storagePath,
            orden,
            tipo,
            formato:      'webp',
            ancho_px:     ancho,
            alto_px:      alto,
            tamano_bytes: finalBuffer.length,
            fuente,
            url_original: urlOriginal,
        })
        .select()
        .single();

    return inserted;
}
