import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processProductDocument, processMultipleDocuments, MultiDocInput } from '@gestor/sync/autoficha';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_MIME = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
];
const MAX_BYTES = 4_000_000; // 4 MB — límite real de Vercel serverless body

// Cliente Supabase server-side (para descargar archivos de Storage)
function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

// ─── Helper: descargar una URL y retornar buffer ──────────────────────────────

async function urlToBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
    let fetchResp: Response;
    try {
        fetchResp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch {
        throw new Error(`No se pudo descargar: ${url}`);
    }

    if (!fetchResp.ok) throw new Error(`La URL respondió con error ${fetchResp.status}: ${url}`);

    const mimeType = fetchResp.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
    if (!ALLOWED_MIME.includes(mimeType)) {
        throw new Error(`Formato no soportado en ${url}: ${mimeType}`);
    }

    const arrBuf = await fetchResp.arrayBuffer();
    const buffer = Buffer.from(arrBuf);
    const fileName = url.split('/').pop()?.split('?')[0] || 'documento';

    return { buffer, mimeType, fileName };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const contentType = req.headers.get('content-type') || '';

        // ── MODO MULTIPART: archivo único pequeño (<4MB) — fallback legacy ────
        if (contentType.includes('multipart/form-data')) {
            const form = await req.formData();
            const file = form.get('file') as File | null;

            if (!file) return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 });

            const mime = file.type || 'application/octet-stream';
            if (!ALLOWED_MIME.includes(mime)) {
                return NextResponse.json({ error: `Formato no soportado: ${mime}. Usa PDF, PNG, JPEG o WEBP.` }, { status: 400 });
            }
            if (file.size > MAX_BYTES) {
                return NextResponse.json({
                    error: `Archivo demasiado grande (${(file.size / 1e6).toFixed(1)} MB). ` +
                           'Para archivos grandes, el sistema los sube directamente a Storage — esto no debería llegar aquí.'
                }, { status: 400 });
            }

            const buffer = Buffer.from(await file.arrayBuffer());

            // Subir a Storage
            let storagePath: string | undefined;
            try {
                const supabase = getSupabaseAdmin();
                storagePath = `autofichas/${Date.now()}_${file.name}`;
                await supabase.storage.from('documentos-fuente').upload(storagePath, buffer, { contentType: mime, upsert: false });
            } catch { storagePath = undefined; }

            const result = await processProductDocument(buffer, file.name, mime, storagePath);
            return NextResponse.json(result);
        }

        // ── MODO JSON: URL única o array de URLs (flujo principal) ───────────
        if (contentType.includes('application/json')) {
            const body = await req.json();

            // Array de URLs (multi-archivo)
            if (Array.isArray(body?.urls) && body.urls.length > 0) {
                const urls: string[] = body.urls;

                if (urls.length > 10) {
                    return NextResponse.json({ error: 'Máximo 10 documentos por procesamiento.' }, { status: 400 });
                }

                // Descargar todos en paralelo
                const downloads = await Promise.all(urls.map(urlToBuffer));

                // Procesar con merge inteligente
                const docs: MultiDocInput[] = downloads.map(d => ({
                    buffer:   d.buffer,
                    fileName: d.fileName,
                    mimeType: d.mimeType,
                }));

                const result = await processMultipleDocuments(docs);
                return NextResponse.json(result);
            }

            // URL única
            const url: string | undefined = body?.url;
            if (!url || !url.startsWith('http')) {
                return NextResponse.json(
                    { error: 'Body JSON debe contener "url" (string) o "urls" (array de strings).' },
                    { status: 400 }
                );
            }

            const { buffer, mimeType, fileName } = await urlToBuffer(url);

            // Para URLs de Storage de proveedores externos, no re-subir
            let storagePath: string | undefined;
            if (!url.includes(process.env.NEXT_PUBLIC_SUPABASE_URL || '')) {
                try {
                    const supabase = getSupabaseAdmin();
                    storagePath = `autofichas/${Date.now()}_${fileName}`;
                    await supabase.storage.from('documentos-fuente').upload(storagePath, buffer, { contentType: mimeType, upsert: false });
                } catch { storagePath = undefined; }
            } else {
                // Ya está en nuestro Storage — usar la ruta de la URL
                storagePath = url.split('/documentos-fuente/').pop();
            }

            const result = await processProductDocument(buffer, fileName, mimeType, storagePath);
            return NextResponse.json(result);
        }

        return NextResponse.json(
            { error: 'Content-Type no soportado. Usa multipart/form-data o application/json.' },
            { status: 400 }
        );

    } catch (error: any) {
        const msg: string = error?.message || 'Error interno al procesar el documento.';
        if (msg.includes('Credenciales Azure')) {
            return NextResponse.json({ error: msg }, { status: 503 });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
