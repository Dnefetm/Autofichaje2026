import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/fichas/[id]/autocompletar
 *
 * Lee el texto existente de la ficha (descripcion, descripcion_larga, especificaciones,
 * bullet_points, uso_recomendado, precauciones, ingredientes) y usa GPT-4o-mini para
 * extraer campos que estén vacíos.
 *
 * IMPORTANTE: No guarda nada. Devuelve sugerencias para que el operador las apruebe
 * en el modal de revisión antes de cualquier escritura en BD.
 *
 * Campos que puede autocompletar:
 * - descripcion (resumen ≤120 chars)
 * - materiales
 * - informacion_normativa
 * - instrucciones_uso
 * - leyendas_precautorias
 * - indicaciones_almacenamiento
 * - palabras_clave (array)
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function getSupabaseAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
}

function isEmpty(v: any): boolean {
    if (v === null || v === undefined || v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
}

export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id: fichaId } = await params;
    const supabase = getSupabaseAdmin();

    // ── Leer ficha completa ──────────────────────────────────────────────────
    const { data: ficha, error } = await supabase
        .from('fichas_tecnicas')
        .select(`
            id, nombre_producto, fabricante, marca, modelo,
            descripcion, descripcion_larga, especificaciones,
            uso_recomendado, precauciones, ingredientes,
            bullet_points, palabras_clave,
            materiales, pais_origen,
            informacion_normativa, instrucciones_uso,
            leyendas_precautorias, indicaciones_almacenamiento
        `)
        .eq('id', fichaId)
        .single();

    if (error || !ficha) {
        return NextResponse.json({ ok: false, error: 'Ficha no encontrada' }, { status: 404 });
    }

    // ── Construir texto base disponible ──────────────────────────────────────
    const textoBase = [
        ficha.nombre_producto ? `NOMBRE: ${ficha.nombre_producto}` : '',
        ficha.descripcion_larga ? `DESCRIPCIÓN LARGA: ${ficha.descripcion_larga}` : '',
        ficha.descripcion ? `DESCRIPCIÓN: ${ficha.descripcion}` : '',
        ficha.especificaciones ? `ESPECIFICACIONES: ${ficha.especificaciones}` : '',
        ficha.uso_recomendado ? `USO RECOMENDADO: ${ficha.uso_recomendado}` : '',
        ficha.precauciones ? `PRECAUCIONES: ${ficha.precauciones}` : '',
        ficha.ingredientes ? `INGREDIENTES/COMPOSICIÓN: ${ficha.ingredientes}` : '',
        ...(ficha.bullet_points?.length ? [`PUNTOS CLAVE:\n${(ficha.bullet_points as string[]).map(b => `• ${b}`).join('\n')}`] : []),
    ].filter(Boolean).join('\n\n');

    if (!textoBase.trim()) {
        return NextResponse.json({
            ok: false,
            error: 'La ficha no tiene suficiente contenido para autocompletar. Añade una descripción o especificaciones primero.',
        }, { status: 400 });
    }

    // ── Identificar campos vacíos que pueden completarse ────────────────────
    const camposVacios: string[] = [];
    if (isEmpty(ficha.descripcion))                  camposVacios.push('descripcion');
    if (isEmpty(ficha.materiales))                   camposVacios.push('materiales');
    if (isEmpty(ficha.informacion_normativa))        camposVacios.push('informacion_normativa');
    if (isEmpty(ficha.instrucciones_uso))            camposVacios.push('instrucciones_uso');
    if (isEmpty(ficha.leyendas_precautorias))        camposVacios.push('leyendas_precautorias');
    if (isEmpty(ficha.indicaciones_almacenamiento))  camposVacios.push('indicaciones_almacenamiento');
    if (isEmpty(ficha.palabras_clave))               camposVacios.push('palabras_clave');

    if (camposVacios.length === 0) {
        return NextResponse.json({
            ok: true,
            sugerencias: {},
            mensaje: 'Todos los campos autocompletables ya están llenos.',
        });
    }

    // ── Prompt GPT-4o-mini ───────────────────────────────────────────────────
    const prompt = `Analiza el siguiente texto de una ficha técnica de producto industrial o herramienta.
Extrae SOLO los campos que puedas identificar con CERTEZA ALTA basándote en la información disponible.
Si no hay suficiente información para un campo, NO lo incluyas en el JSON.

CAMPOS A EXTRAER (solo los que apliquen):
${camposVacios.includes('descripcion') ? '- descripcion: Resumen descriptivo del producto en máximo 120 caracteres. Qué es y para qué sirve.' : ''}
${camposVacios.includes('materiales') ? '- materiales: Material(es) principal(es) del producto (ej: "Acero al carbono", "Polipropileno", "Acero inoxidable 316L").' : ''}
${camposVacios.includes('informacion_normativa') ? '- informacion_normativa: Normas, certificaciones o estándares mencionados (ej: "NOM-018-STPS-2015", "ISO 9001", "DIN EN 14291"). Solo los citados explícitamente.' : ''}
${camposVacios.includes('instrucciones_uso') ? '- instrucciones_uso: Pasos o instrucciones de aplicación/uso mencionados. Máximo 300 caracteres.' : ''}
${camposVacios.includes('leyendas_precautorias') ? '- leyendas_precautorias: Advertencias de seguridad, frases GHS, o leyendas de peligro mencionadas.' : ''}
${camposVacios.includes('indicaciones_almacenamiento') ? '- indicaciones_almacenamiento: Condiciones de almacenamiento mencionadas (temperatura, humedad, posición, etc.).' : ''}
${camposVacios.includes('palabras_clave') ? '- palabras_clave: Array de 5-8 términos de búsqueda relevantes para este producto en MercadoLibre. Sin artículos ni preposiciones.' : ''}

TEXTO DE LA FICHA:
${textoBase.slice(0, 6000)}

Responde SOLO con un objeto JSON con los campos encontrados. Ejemplo:
{
  "descripcion": "Lubricante industrial de alta temperatura para componentes metálicos",
  "materiales": "Acero al carbono forjado",
  "palabras_clave": ["lubricante industrial", "alta temperatura", "grasa sintética"]
}`;

    let sugerencias: Record<string, any> = {};
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 800,
            response_format: { type: 'json_object' },
        });
        const raw = completion.choices[0]?.message?.content?.trim() || '{}';
        sugerencias = JSON.parse(raw);

        // Sanitizar: solo incluir campos solicitados y no vacíos
        for (const k of Object.keys(sugerencias)) {
            if (!camposVacios.includes(k)) delete sugerencias[k];
            if (isEmpty(sugerencias[k])) delete sugerencias[k];
        }
        // descripcion: truncar a 120 chars
        if (sugerencias.descripcion && typeof sugerencias.descripcion === 'string') {
            sugerencias.descripcion = sugerencias.descripcion.slice(0, 120);
        }
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: `Error de LLM: ${err.message}` }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        sugerencias,
        campos_vacios_analizados: camposVacios,
        campos_encontrados: Object.keys(sugerencias),
        texto_analizado_chars: textoBase.length,
    });
}
