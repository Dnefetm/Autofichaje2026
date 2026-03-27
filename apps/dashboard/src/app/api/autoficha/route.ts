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

// ─── Helper v4: separar atributos_tecnicos en 2 cubetas ──────────────────────
// Consulta la plantilla de la categoría y clasifica cada atributo extraído por la IA
// como "de plantilla" (campos definidos) o "extra" (detectados pero no en plantilla).

async function splitAtributos(
    categoria: string | undefined,
    atributos_tecnicos: Record<string, any> = {},
): Promise<{
    atributos_categoria: Record<string, any>;
    atributos_extras:    Record<string, any>;
}> {
    if (Object.keys(atributos_tecnicos).length === 0) {
        return { atributos_categoria: {}, atributos_extras: {} };
    }

    try {
        const supabase = getSupabaseAdmin();
        const { data: plantilla } = await supabase
            .from('categoria_plantillas')
            .select('campos')
            .eq('categoria', categoria ?? '')
            .single();

        const camposPlantilla = new Set<string>(
            (plantilla?.campos ?? []).map((c: { key: string }) => c.key)
        );

        const atributos_categoria: Record<string, any> = {};
        const atributos_extras:    Record<string, any> = {};

        for (const [key, value] of Object.entries(atributos_tecnicos)) {
            if (camposPlantilla.has(key)) atributos_categoria[key] = value;
            else                          atributos_extras[key]    = value;
        }

        return { atributos_categoria, atributos_extras };
    } catch {
        // Si la consulta falla (tabla no existe aún, etc.), todo va a extras
        return { atributos_categoria: {}, atributos_extras: atributos_tecnicos };
    }
}


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
            const { atributos_categoria, atributos_extras } = await splitAtributos(
                result.categoria, result.atributos_tecnicos
            );
            return NextResponse.json({ ...result, atributos_categoria, atributos_extras });
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
                const { atributos_categoria, atributos_extras } = await splitAtributos(
                    result.categoria, result.atributos_tecnicos
                );
                return NextResponse.json({ ...result, atributos_categoria, atributos_extras });
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
            const { atributos_categoria, atributos_extras } = await splitAtributos(
                result.categoria, result.atributos_tecnicos
            );
            return NextResponse.json({ ...result, atributos_categoria, atributos_extras });
        }

        return NextResponse.json(
            { error: 'Content-Type no soportado. Usa multipart/form-data o application/json.' },
            { status: 400 }
        );

    } catch (error: any) {
        const msg: string  = error?.message    || '';
        const code: string = error?.code       || '';
        const status: number = error?.statusCode || error?.status || 500;

        // ── Errores específicos de Azure Document Intelligence ─────────────────
        if (msg.includes('Credenciales Azure') || msg.includes('AZURE_DI')) {
            return NextResponse.json({
                error: 'Las credenciales de Azure no están configuradas. Contacta al administrador.'
            }, { status: 503 });
        }
        if (status === 401 || code === 'Unauthorized') {
            return NextResponse.json({
                error: 'Las credenciales de Azure son inválidas. Verifica AZURE_DI_KEY y AZURE_DI_ENDPOINT.'
            }, { status: 503 });
        }
        if (status === 429 || code === 'TooManyRequests' || msg.toLowerCase().includes('quota')) {
            return NextResponse.json({
                error: 'Se alcanzó el límite de uso del servicio de OCR. Espera unos minutos e intenta de nuevo.'
            }, { status: 429 });
        }
        if (msg.toLowerCase().includes('file size') || msg.toLowerCase().includes('content length') || msg.toLowerCase().includes('request entity too large')) {
            return NextResponse.json({
                error: 'El documento es demasiado grande para el servicio de OCR. Máximo ~4 MB por documento. Intenta con una resolución menor o divide el PDF.'
            }, { status: 400 });
        }
        if (msg.toLowerCase().includes('unsupported') || msg.toLowerCase().includes('invalid content type') || msg.toLowerCase().includes('format')) {
            return NextResponse.json({
                error: 'El formato del documento no es compatible con el servicio de OCR. Usa PDF, PNG, JPEG o WEBP.'
            }, { status: 400 });
        }
        if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('timed out') || msg.toLowerCase().includes('operation timed out')) {
            return NextResponse.json({
                error: 'El procesamiento tardó demasiado. Intenta con un documento más pequeño o de menor resolución.'
            }, { status: 408 });
        }
        if (msg.toLowerCase().includes('text legible') || msg.includes('suficiente')) {
            // Error propio de autoficha.ts — ya tiene mensaje en español
            return NextResponse.json({ error: msg }, { status: 422 });
        }

        // Error genérico — log para debugging
        console.error('[autoficha route] error:', { code, status, msg: msg.slice(0, 500) });
        return NextResponse.json({
            error: msg || 'Error interno al procesar el documento. Revisa la consola de Vercel para más detalle.'
        }, { status: 500 });
    }
}
