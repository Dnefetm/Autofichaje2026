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
    // Identidad propia de la ficha (v41a)
    { key: 'marca',             label: 'Marca',                llmKey: 'marca' },
    { key: 'modelo',            label: 'Modelo',               llmKey: 'modelo' },
    { key: 'variante',          label: 'Variante',             llmKey: 'variante' },
    { key: 'codigo_universal',  label: 'Código EAN/UPC',       llmKey: 'codigo_universal' },
    { key: 'categoria',         label: 'Categoría',            llmKey: 'categoria' },
    { key: 'materiales',        label: 'Materiales',           llmKey: 'materiales' },
    { key: 'pais_origen',       label: 'País de origen',       llmKey: 'pais_origen' },
    // Campos regulatorios / etiquetado obligatorio (v46)
    { key: 'informacion_normativa',       label: 'Información normativa',       llmKey: 'informacion_normativa' },
    { key: 'instrucciones_uso',           label: 'Instrucciones de uso',        llmKey: 'instrucciones_uso' },
    { key: 'leyendas_precautorias',       label: 'Leyendas precautorias',       llmKey: 'leyendas_precautorias' },
    { key: 'indicaciones_almacenamiento', label: 'Indicaciones de almacenamiento', llmKey: 'indicaciones_almacenamiento' },
];

// Campos numéricos (dimensiones y peso) — requieren comparación numérica, no de string
const CAMPOS_NUM: Array<{ key: string; label: string; llmKey: string }> = [
    { key: 'peso_kg',  label: 'Peso (kg)',   llmKey: 'peso_kg' },
    { key: 'largo_cm', label: 'Largo (cm)',  llmKey: 'largo_cm' },
    { key: 'ancho_cm', label: 'Ancho (cm)',  llmKey: 'ancho_cm' },
    { key: 'alto_cm',  label: 'Alto (cm)',   llmKey: 'alto_cm' },
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

    // 1. Cargar ficha actual — incluyendo TODOS los campos comparables (v41a + v46)
    const { data: ficha, error: fichaErr } = await supabase
        .from('fichas_tecnicas')
        .select(`
            id,
            nombre_producto, descripcion, descripcion_larga,
            fabricante, especificaciones, uso_recomendado,
            precauciones, ingredientes,
            bullet_points, palabras_clave,
            atributos_dinamicos, atributos_categoria, atributos_extras,
            marca, modelo, variante, codigo_universal, categoria,
            materiales, pais_origen,
            peso_kg, largo_cm, ancho_cm, alto_cm,
            informacion_normativa, instrucciones_uso,
            leyendas_precautorias, indicaciones_almacenamiento
        `)
        .eq('id', fichaId)
        .single();

    if (fichaErr || !ficha) return NextResponse.json({ error: 'Ficha no encontrada' }, { status: 404 });

    // 2. Obtener documento y campos_solicitados
    const contentType = req.headers.get('content-type') || '';
    let buffer: Buffer;
    let mimeType: string;
    let fileName: string;
    let storagePath: string | undefined;
    let camposHint: string[] | undefined;

    try {
        if (contentType.includes('multipart/form-data')) {
            const form = await req.formData();
            const file = form.get('file') as File | null;
            if (!file) return NextResponse.json({ error: 'No se reció archivo' }, { status: 400 });
            if (!ALLOWED_MIME.includes(file.type)) return NextResponse.json({ error: `Formato no soportado: ${file.type}` }, { status: 400 });
            if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Archivo demasiado grande (máx 4 MB)' }, { status: 400 });
            buffer = Buffer.from(await file.arrayBuffer()); mimeType = file.type; fileName = file.name;
            // Leer campos_solicitados del formData si los envía el frontend
            const camposRaw = form.get('campos_solicitados') as string | null;
            if (camposRaw) { try { camposHint = JSON.parse(camposRaw); } catch { /* ignorar mal formato */ } }
        } else if (contentType.includes('application/json')) {
            const body = await req.json();
            const url: string = body?.url;
            if (!url?.startsWith('http')) return NextResponse.json({ error: 'Body debe contener "url"' }, { status: 400 });
            const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            if (!resp.ok) return NextResponse.json({ error: `URL respondió ${resp.status}` }, { status: 400 });
            mimeType = resp.headers.get('content-type')?.split(';')[0] || 'application/pdf';
            if (!ALLOWED_MIME.includes(mimeType)) return NextResponse.json({ error: `Formato no soportado: ${mimeType}` }, { status: 400 });
            buffer = Buffer.from(await resp.arrayBuffer()); fileName = url.split('/').pop()?.split('?')[0] || 'documento';
            if (Array.isArray(body?.campos_solicitados)) camposHint = body.campos_solicitados;
        } else {
            return NextResponse.json({ error: 'Content-Type no soportado' }, { status: 400 });
        }
    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error al obtener el documento' }, { status: 500 });
    }

    // 3. Storage (auditíria)
    try {
        storagePath = `enriquecimientos/${fichaId}/${Date.now()}_${fileName}`;
        await supabase.storage.from('documentos-fuente').upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    } catch { storagePath = undefined; }

    // 4. OCR + LLM — con hint de campos si el operador los especificó
    // Si camposHint viene vacío (sin campos seleccionados), rechazar
    if (camposHint && camposHint.length === 0) {
        return NextResponse.json({ error: 'Selecciona al menos un campo para enriquecer.' }, { status: 400 });
    }

    // Mapear keys de BD a labels que el LLM entiende (usa los llmKey de cada array)
    const todosLosCampos = [...CAMPOS_TEXTO, ...CAMPOS_NUM, ...CAMPOS_LISTA, ...CAMPOS_JSONB];
    const camposLLM = camposHint
        ? camposHint.map(k => todosLosCampos.find(c => c.key === k)?.llmKey ?? k).filter(Boolean)
        : undefined;
    let extracted: any;
    try {
        extracted = await processProductDocument(buffer, fileName, mimeType, storagePath, camposLLM);
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

    // 6. Clasificar TODOS los campos — filtrar por campos_solicitados si vienen
    // IMPORTANTE: ninguno se auto-aplica. Todo va al modal para aprobación del operador.
    const camposParaRevisar: ResultadoCampo[] = [];

    const camposFiltradosTexto = camposHint
        ? CAMPOS_TEXTO.filter(c => camposHint.includes(c.key))
        : CAMPOS_TEXTO;
    const camposFiltradosNum = camposHint
        ? CAMPOS_NUM.filter(c => camposHint.includes(c.key))
        : CAMPOS_NUM;
    const camposFiltradosLista = camposHint
        ? CAMPOS_LISTA.filter(c => camposHint.includes(c.key))
        : CAMPOS_LISTA;
    const camposFiltradosJsonb = camposHint
        ? CAMPOS_JSONB.filter(c => camposHint.includes(c.key))
        : CAMPOS_JSONB;

    for (const { key, label, llmKey } of camposFiltradosTexto) {
        const r = clasificarTexto((ficha as any)[key], extracted[llmKey], key, label);
        if (r) camposParaRevisar.push(r);
    }

    for (const { key, label, llmKey } of camposFiltradosLista) {
        const r = clasificarLista((ficha as any)[key], extracted[llmKey], key, label);
        if (r) camposParaRevisar.push(r);
    }

    for (const { key, label, llmKey } of camposFiltradosJsonb) {
        const r = clasificarJsonb((ficha as any)[key], extracted[llmKey], key, label);
        if (r) camposParaRevisar.push(r);
    }

    for (const { key, label, llmKey } of camposFiltradosNum) {
        const actual = (ficha as any)[key];
        const nuevo  = extracted[llmKey];
        const nuevoNum = nuevo != null && nuevo !== '' ? Number(nuevo) : null;
        if (nuevoNum == null || isNaN(nuevoNum)) continue;
        if (actual == null) {
            // Campo vacío — va al modal con acción 'agregar' (operador puede rechazar)
            camposParaRevisar.push({ campo: key, label, tipo: 'texto', accion: 'agregar',
                valor_actual: null, valor_nuevo: nuevoNum });
        } else if (Math.abs(Number(actual) - nuevoNum) > 0.001) {
            camposParaRevisar.push({ campo: key, label, tipo: 'texto', accion: 'conflicto',
                valor_actual: actual, valor_nuevo: nuevoNum });
        }
    }

    // 7. Sin cambios detectados
    if (camposParaRevisar.length === 0) {
        if (extraccion?.id) {
            await supabase.from('ficha_extracciones').update({ aplicada_a_ficha: true }).eq('id', extraccion.id);
        }
        return NextResponse.json({ ok: true, extraccion_id: extraccion?.id ?? null,
            campos_para_revisar: [], sin_cambios: true });
    }

    return NextResponse.json({
        ok: true,
        extraccion_id:      extraccion?.id ?? null,
        campos_para_revisar: camposParaRevisar,
        total:              camposParaRevisar.length,
        sin_cambios:        false,
    });
}
