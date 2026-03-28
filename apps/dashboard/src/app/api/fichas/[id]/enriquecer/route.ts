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

// ─── Tipos ────────────────────────────────────────────────────────────────────

type AccionCampo = 'agregar' | 'conflicto' | 'identico';
type TipoCampo   = 'texto' | 'lista' | 'jsonb';

interface ResultadoCampo {
    campo:        string;
    label:        string;
    tipo:         TipoCampo;
    accion:       AccionCampo;
    valor_actual: any;
    valor_nuevo:  any;
    // Solo para listas: items nuevos que no están en el actual
    items_nuevos?: string[];
    // Solo para jsonb: keys nuevas y keys en conflicto
    keys_nuevas?:     Record<string, any>;
    keys_conflicto?:  Record<string, { actual: any; nuevo: any }>;
}

// ─── Definición de campos comparables ────────────────────────────────────────

const CAMPOS_TEXTO: Array<{ key: string; label: string; llmKey: string }> = [
    { key: 'nombre_producto',   label: 'Nombre del producto',  llmKey: 'nombre' },
    { key: 'descripcion',       label: 'Descripción técnica',  llmKey: 'descripcion' },
    { key: 'descripcion_larga', label: 'Descripción extendida', llmKey: 'descripcion_larga' },
    { key: 'fabricante',        label: 'Fabricante',           llmKey: 'fabricante' },
    { key: 'especificaciones',  label: 'Especificaciones',     llmKey: 'especificaciones' },
    { key: 'uso_recomendado',   label: 'Uso recomendado',      llmKey: 'uso_recomendado' },
    { key: 'precauciones',      label: 'Precauciones',         llmKey: 'precauciones' },
    { key: 'ingredientes',      label: 'Ingredientes',         llmKey: 'ingredientes' },
];

const CAMPOS_LISTA: Array<{ key: string; label: string; llmKey: string }> = [
    { key: 'bullet_points',  label: 'Puntos clave',   llmKey: 'bullet_points' },
    { key: 'palabras_clave', label: 'Palabras clave', llmKey: 'palabras_clave' },
];

const CAMPOS_JSONB: Array<{ key: string; label: string; llmKey: string }> = [
    { key: 'atributos_dinamicos', label: 'Atributos técnicos', llmKey: 'atributos_tecnicos' },
];

function isEmpty(v: any): boolean {
    if (v === null || v === undefined || v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return true;
    return false;
}

// ─── Clasificar campos ────────────────────────────────────────────────────────

function clasificarTexto(actual: any, nuevo: any, campo: string, label: string): ResultadoCampo | null {
    if (isEmpty(nuevo)) return null;
    if (isEmpty(actual)) {
        return { campo, label, tipo: 'texto', accion: 'agregar', valor_actual: null, valor_nuevo: nuevo };
    }
    if (String(actual).trim() === String(nuevo).trim()) return null; // idéntico
    return { campo, label, tipo: 'texto', accion: 'conflicto', valor_actual: actual, valor_nuevo: nuevo };
}

function clasificarLista(actual: string[] | null, nuevo: string[] | null, campo: string, label: string): ResultadoCampo | null {
    if (!nuevo || nuevo.length === 0) return null;
    const actualSet = new Set((actual ?? []).map(s => s.toLowerCase().trim()));
    const itemsNuevos = nuevo.filter(s => !actualSet.has(s.toLowerCase().trim()));

    if (itemsNuevos.length === 0) return null; // todos ya existen

    if (!actual || actual.length === 0) {
        return { campo, label, tipo: 'lista', accion: 'agregar', valor_actual: [], valor_nuevo: nuevo, items_nuevos: itemsNuevos };
    }
    return { campo, label, tipo: 'lista', accion: 'conflicto', valor_actual: actual, valor_nuevo: nuevo, items_nuevos: itemsNuevos };
}

function clasificarJsonb(actual: Record<string, any> | null, nuevo: Record<string, any> | null, campo: string, label: string): ResultadoCampo | null {
    if (!nuevo || Object.keys(nuevo).length === 0) return null;
    const act = actual ?? {};
    const keysNuevas: Record<string, any> = {};
    const keysConflicto: Record<string, { actual: any; nuevo: any }> = {};

    for (const [k, v] of Object.entries(nuevo)) {
        if (!(k in act) || isEmpty(act[k])) {
            keysNuevas[k] = v;
        } else if (String(act[k]) !== String(v)) {
            keysConflicto[k] = { actual: act[k], nuevo: v };
        }
    }

    if (Object.keys(keysNuevas).length === 0 && Object.keys(keysConflicto).length === 0) return null;

    const accion: AccionCampo = Object.keys(keysConflicto).length > 0 ? 'conflicto' : 'agregar';
    return { campo, label, tipo: 'jsonb', accion, valor_actual: act, valor_nuevo: nuevo, keys_nuevas: keysNuevas, keys_conflicto: keysConflicto };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: fichaId } = await params;
    if (!fichaId) return NextResponse.json({ error: 'fichaId requerido' }, { status: 400 });

    const supabase = getSupabaseAdmin();

    // 1. Cargar ficha actual
    const { data: ficha, error: fichaErr } = await supabase
        .from('fichas_tecnicas')
        .select('id, nombre_producto, descripcion, descripcion_larga, fabricante, especificaciones, uso_recomendado, precauciones, ingredientes, bullet_points, palabras_clave, atributos_dinamicos, atributos_categoria, atributos_extras')
        .eq('id', fichaId)
        .single();

    if (fichaErr || !ficha) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 });

    // 2. Obtener documento
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
            buffer = Buffer.from(await file.arrayBuffer()); mimeType = file.type; fileName = file.name;
        } else if (contentType.includes('application/json')) {
            const body = await req.json();
            const url: string = body?.url;
            if (!url?.startsWith('http')) return NextResponse.json({ error: 'Body debe contener "url"' }, { status: 400 });
            const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            if (!resp.ok) return NextResponse.json({ error: `URL respondió ${resp.status}` }, { status: 400 });
            mimeType = resp.headers.get('content-type')?.split(';')[0] || 'application/pdf';
            if (!ALLOWED_MIME.includes(mimeType)) return NextResponse.json({ error: `Formato no soportado: ${mimeType}` }, { status: 400 });
            buffer = Buffer.from(await resp.arrayBuffer()); fileName = url.split('/').pop()?.split('?')[0] || 'documento';
        } else {
            return NextResponse.json({ error: 'Content-Type no soportado' }, { status: 400 });
        }
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error al obtener el documento' }, { status: 500 });
    }

    // 3. Storage (auditoría)
    try {
        storagePath = `enriquecimientos/${fichaId}/${Date.now()}_${fileName}`;
        await supabase.storage.from('documentos-fuente').upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    } catch { storagePath = undefined; }

    // 4. OCR + LLM
    let extracted: any;
    try {
        extracted = await processProductDocument(buffer, fileName, mimeType, storagePath);
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error de OCR/LLM' }, { status: 500 });
    }

    // 5. Guardar extracción como pendiente
    const { data: extraccion } = await supabase
        .from('ficha_extracciones')
        .insert({
            ficha_tecnica_id: fichaId,
            extraccion_cruda: { ...extracted, rawText: extracted.rawText?.slice(0, 10_000) },
            aplicada_a_ficha: false,
        })
        .select('id')
        .single();

    // 6. Clasificar por campo: agregar | conflicto | identico
    const resultados: ResultadoCampo[] = [];
    const camposAgregadosAutomaticamente: Record<string, any> = {};

    for (const { key, label, llmKey } of CAMPOS_TEXTO) {
        const r = clasificarTexto((ficha as any)[key], extracted[llmKey], key, label);
        if (!r) continue;
        if (r.accion === 'agregar') {
            // Agregar automáticamente — sin decisión del usuario
            camposAgregadosAutomaticamente[key] = r.valor_nuevo;
        } else {
            resultados.push(r);
        }
    }

    for (const { key, label, llmKey } of CAMPOS_LISTA) {
        const r = clasificarLista((ficha as any)[key], extracted[llmKey], key, label);
        if (!r) continue;
        if (r.accion === 'agregar') {
            camposAgregadosAutomaticamente[key] = r.valor_nuevo;
        } else {
            resultados.push(r);
        }
    }

    for (const { key, label, llmKey } of CAMPOS_JSONB) {
        const r = clasificarJsonb((ficha as any)[key], extracted[llmKey], key, label);
        if (!r) continue;
        if (r.accion === 'agregar') {
            camposAgregadosAutomaticamente[key] = { ...(ficha as any)[key] ?? {}, ...r.keys_nuevas };
        } else {
            resultados.push(r);
        }
    }

    // 7. Aplicar automáticamente los campos sin conflicto
    let camposAgregados: string[] = [];
    if (Object.keys(camposAgregadosAutomaticamente).length > 0) {
        const { error: autoErr } = await supabase
            .from('fichas_tecnicas')
            .update(camposAgregadosAutomaticamente)
            .eq('id', fichaId);
        if (!autoErr) camposAgregados = Object.keys(camposAgregadosAutomaticamente);
    }

    // Si no hay conflictos y sí hubo campos agregados: marcar extracción como aplicada
    if (resultados.length === 0 && extraccion?.id) {
        await supabase.from('ficha_extracciones')
            .update({ aplicada_a_ficha: true })
            .eq('id', extraccion.id);
    }

    return NextResponse.json({
        ok: true,
        extraccion_id:     extraccion?.id ?? null,
        conflictos:        resultados,
        campos_agregados:  camposAgregados,
        total_conflictos:  resultados.length,
        sin_cambios:       resultados.length === 0 && camposAgregados.length === 0,
    });
}
