import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processProductDocument } from '@gestor/sync/autoficha';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_MIME = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
];
const MAX_BYTES = 10_000_000; // 10 MB

// Cliente Supabase para Storage (server-side)
function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

export async function POST(req: NextRequest) {
    try {
        let buffer: Buffer;
        let fileName: string;
        let mimeType: string;

        const contentType = req.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            // ── Modo archivo ───────────────────────────────────────────────────
            const form = await req.formData();
            const file = form.get('file') as File | null;

            if (!file) {
                return NextResponse.json(
                    { error: 'No se recibió ningún archivo.' },
                    { status: 400 }
                );
            }

            // Validar MIME type
            const mime = file.type || 'application/octet-stream';
            if (!ALLOWED_MIME.includes(mime)) {
                return NextResponse.json(
                    { error: `Formato no soportado: ${mime}. Usa PDF, PNG, JPEG o WEBP.` },
                    { status: 400 }
                );
            }

            // Validar tamaño
            if (file.size > MAX_BYTES) {
                return NextResponse.json(
                    { error: `Archivo demasiado grande (${(file.size / 1e6).toFixed(1)} MB). Máximo 10 MB.` },
                    { status: 400 }
                );
            }

            buffer   = Buffer.from(await file.arrayBuffer());
            fileName = file.name;
            mimeType = mime;

        } else if (contentType.includes('application/json')) {
            // ── Modo URL ───────────────────────────────────────────────────────
            const body = await req.json();
            const url: string | undefined = body?.url;

            if (!url || !url.startsWith('http')) {
                return NextResponse.json(
                    { error: 'URL inválida. Debe comenzar con http:// o https://' },
                    { status: 400 }
                );
            }

            let fetchResp: Response;
            try {
                fetchResp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            } catch {
                return NextResponse.json(
                    { error: 'No se pudo descargar el documento desde la URL proporcionada.' },
                    { status: 400 }
                );
            }

            if (!fetchResp.ok) {
                return NextResponse.json(
                    { error: `La URL respondió con error ${fetchResp.status}.` },
                    { status: 400 }
                );
            }

            mimeType = fetchResp.headers.get('content-type')?.split(';')[0] || 'application/octet-stream';
            if (!ALLOWED_MIME.includes(mimeType)) {
                return NextResponse.json(
                    { error: `El recurso en la URL tiene un formato no soportado: ${mimeType}.` },
                    { status: 400 }
                );
            }

            const arrBuf = await fetchResp.arrayBuffer();
            if (arrBuf.byteLength > MAX_BYTES) {
                return NextResponse.json(
                    { error: `El documento en la URL supera el límite de 10 MB.` },
                    { status: 400 }
                );
            }

            buffer   = Buffer.from(arrBuf);
            fileName = url.split('/').pop()?.split('?')[0] || 'documento';
            if (!fileName.includes('.')) fileName += mimeType === 'application/pdf' ? '.pdf' : '.jpg';

        } else {
            return NextResponse.json(
                { error: 'Content-Type no soportado. Usa multipart/form-data o application/json.' },
                { status: 400 }
            );
        }

        // ── Subir documento original a Storage ─────────────────────────────────
        let storagePath: string | undefined;
        try {
            const supabase = getSupabaseAdmin();
            const ts = Date.now();
            storagePath = `autofichas/${ts}_${fileName}`;
            await supabase.storage
                .from('documentos-fuente')
                .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
        } catch {
            // No bloquear el flujo si Storage falla — solo perder la persistencia
            storagePath = undefined;
        }

        // ── OCR + IA ───────────────────────────────────────────────────────────
        const result = await processProductDocument(buffer, fileName, mimeType, storagePath);

        return NextResponse.json(result);

    } catch (error: any) {
        const msg: string = error?.message || 'Error interno al procesar el documento.';

        // Mensaje amigable para errores de credenciales
        if (msg.includes('Credenciales Azure')) {
            return NextResponse.json({ error: msg }, { status: 503 });
        }

        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
