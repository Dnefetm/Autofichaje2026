import { NextRequest, NextResponse } from 'next/server';
import { discoverProducts } from '@gestor/sync/autoficha';

export const runtime    = 'nodejs';
export const maxDuration = 30; // Más rápido que la extracción completa

const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_BYTES    = 4_000_000;

// POST /api/fichas/[id]/descubrir-productos
// Etapa 1 del flujo de 2 etapas:
// Hace OCR + mini-LLM para listar todos los productos del documento.
// El frontend muestra la lista como radio buttons para que el operador elija el exacto.
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    await params; // fichaId no se usa aquí pero es necesario para el routing

    const contentType = req.headers.get('content-type') || '';
    let buffer: Buffer;
    let mimeType: string;

    try {
        if (contentType.includes('multipart/form-data')) {
            const form = await req.formData();
            const file = form.get('file') as File | null;
            if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
            if (!ALLOWED_MIME.includes(file.type))
                return NextResponse.json({ error: `Formato no soportado: ${file.type}` }, { status: 400 });
            if (file.size > MAX_BYTES)
                return NextResponse.json({ error: 'Archivo demasiado grande (máx 4 MB)' }, { status: 400 });
            buffer   = Buffer.from(await file.arrayBuffer());
            mimeType = file.type;
        } else if (contentType.includes('application/json')) {
            const body = await req.json();
            const url: string = body?.url;
            if (!url?.startsWith('http'))
                return NextResponse.json({ error: 'Body debe contener "url"' }, { status: 400 });
            const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            if (!resp.ok)
                return NextResponse.json({ error: `URL respondió ${resp.status}` }, { status: 400 });
            mimeType = resp.headers.get('content-type')?.split(';')[0] || 'application/pdf';
            if (!ALLOWED_MIME.includes(mimeType))
                return NextResponse.json({ error: `Formato no soportado: ${mimeType}` }, { status: 400 });
            buffer = Buffer.from(await resp.arrayBuffer());
        } else {
            return NextResponse.json({ error: 'Content-Type no soportado' }, { status: 400 });
        }
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error al obtener el documento' }, { status: 500 });
    }

    try {
        const productos = await discoverProducts(buffer, mimeType);
        return NextResponse.json({ ok: true, productos });
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error de OCR/LLM' }, { status: 500 });
    }
}
