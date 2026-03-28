import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processProductDocument } from '@gestor/sync/autoficha';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_BYTES = 4_000_000;

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

// Campos comparables de una ficha (qué puede discrepar con una nueva extracción)
const CAMPOS_COMPARABLES: Array<{ key: string; label: string }> = [
    { key: 'nombre_producto',   label: 'Nombre del producto' },
    { key: 'descripcion',       label: 'Descripción técnica' },
    { key: 'descripcion_larga', label: 'Descripción extendida' },
    { key: 'fabricante',        label: 'Fabricante' },
    { key: 'especificaciones',  label: 'Especificaciones' },
    { key: 'uso_recomendado',   label: 'Uso recomendado' },
    { key: 'precauciones',      label: 'Precauciones' },
    { key: 'ingredientes',      label: 'Ingredientes' },
    { key: 'bullet_points',     label: 'Puntos clave' },
    { key: 'palabras_clave',    label: 'Palabras clave' },
];

// Mapa de clave extracción LLM → columna fichas_tecnicas
const MAP_LLM_TO_FICHA: Record<string, string> = {
    nombre:           'nombre_producto',
    descripcion:      'descripcion',
    descripcion_larga: 'descripcion_larga',
    fabricante:       'fabricante',
    especificaciones: 'especificaciones',
    uso_recomendado:  'uso_recomendado',
    precauciones:     'precauciones',
    ingredientes:     'ingredientes',
    bullet_points:    'bullet_points',
    palabras_clave:   'palabras_clave',
};

function valuesEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
    return false;
}

// POST /api/fichas/[id]/enriquecer
// Recibe multipart (file) o JSON ({ url }).
// Procesa OCR+LLM, guarda en ficha_extracciones con aplicada_a_ficha=false,
// retorna los campos con discrepancias para que el usuario elija.
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: fichaId } = await params;
    if (!fichaId) return NextResponse.json({ error: 'fichaId requerido' }, { status: 400 });

    const supabase = getSupabaseAdmin();

    // 1. Verificar que la ficha existe
    const { data: ficha, error: fichaErr } = await supabase
        .from('fichas_tecnicas')
        .select('id, nombre_producto, descripcion, descripcion_larga, fabricante, especificaciones, uso_recomendado, precauciones, ingredientes, bullet_points, palabras_clave, atributos_dinamicos, atributos_categoria, atributos_extras')
        .eq('id', fichaId)
        .single();

    if (fichaErr || !ficha) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 });

    // 2. Obtener el documento (file upload o URL)
    const contentType = req.headers.get('content-type') || '';
    let buffer: Buffer;
    let mimeType: string;
    let fileName: string;
    let storagePath: string | undefined;

    try {
        if (contentType.includes('multipart/form-data')) {
            const form = await req.formData();
            const file = form.get('file') as File | null;
            if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
            if (!ALLOWED_MIME.includes(file.type)) return NextResponse.json({ error: `Formato no soportado: ${file.type}` }, { status: 400 });
            if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Archivo demasiado grande (máx 4 MB)' }, { status: 400 });
            buffer   = Buffer.from(await file.arrayBuffer());
            mimeType = file.type;
            fileName = file.name;
        } else if (contentType.includes('application/json')) {
            const body = await req.json();
            const url: string = body?.url;
            if (!url?.startsWith('http')) return NextResponse.json({ error: 'Body debe contener "url"' }, { status: 400 });
            const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            if (!resp.ok) return NextResponse.json({ error: `URL respondió ${resp.status}` }, { status: 400 });
            mimeType = resp.headers.get('content-type')?.split(';')[0] || 'application/pdf';
            if (!ALLOWED_MIME.includes(mimeType)) return NextResponse.json({ error: `Formato no soportado: ${mimeType}` }, { status: 400 });
            buffer   = Buffer.from(await resp.arrayBuffer());
            fileName = url.split('/').pop()?.split('?')[0] || 'documento';
        } else {
            return NextResponse.json({ error: 'Content-Type no soportado' }, { status: 400 });
        }
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error al procesar el documento' }, { status: 500 });
    }

    // 3. Subir a Storage (auditoría)
    try {
        storagePath = `enriquecimientos/${fichaId}/${Date.now()}_${fileName}`;
        await supabase.storage.from('documentos-fuente').upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    } catch { storagePath = undefined; }

    // 4. OCR + LLM
    let extracted;
    try {
        extracted = await processProductDocument(buffer, fileName, mimeType, storagePath);
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error de OCR/LLM' }, { status: 500 });
    }

    // 5. Guardar extracción en ficha_extracciones (pendiente de aplicar)
    const { data: extraccion, error: extErr } = await supabase
        .from('ficha_extracciones')
        .insert({
            ficha_tecnica_id: fichaId,
            extraccion_cruda: { ...extracted, rawText: extracted.rawText?.slice(0, 10_000) },
            aplicada_a_ficha: false,
        })
        .select('id')
        .single();

    if (extErr) console.warn('[enriquecer] error al guardar extraccion:', extErr.message);

    // 6. Calcular discrepancias campo a campo
    const discrepancias: Array<{
        campo: string; label: string;
        valor_actual: any; valor_nuevo: any;
        auto_seleccionar: 'actual' | 'nuevo';
    }> = [];

    for (const { key, label } of CAMPOS_COMPARABLES) {
        // Obtener el valor nuevo — mapeando de la clave del LLM a la de fichas_tecnicas
        const llmKey = Object.entries(MAP_LLM_TO_FICHA).find(([, v]) => v === key)?.[0] ?? key;
        const valorNuevo = (extracted as any)[llmKey];
        const valorActual = (ficha as any)[key];

        // Solo se muestra si el nuevo tiene valor
        if (valorNuevo === undefined || valorNuevo === null) continue;
        if (Array.isArray(valorNuevo) && valorNuevo.length === 0) continue;

        if (valuesEqual(valorActual, valorNuevo)) continue; // sin discrepancia

        discrepancias.push({
            campo: key,
            label,
            valor_actual: valorActual ?? null,
            valor_nuevo:  valorNuevo,
            // Si el actual está vacío, auto-seleccionar el nuevo
            auto_seleccionar: (valorActual === null || valorActual === undefined || valorActual === '' ||
                               (Array.isArray(valorActual) && valorActual.length === 0))
                ? 'nuevo' : 'actual',
        });
    }

    return NextResponse.json({
        ok: true,
        extraccion_id: extraccion?.id ?? null,
        discrepancias,
        total_discrepancias: discrepancias.length,
        mensaje: discrepancias.length === 0 ? 'Los datos del nuevo documento coinciden con la ficha existente.' : undefined,
    });
}
