/**
 * listing-ai.ts — Generador de contenido de publicación (título + descripción)
 * con GPT-4o-mini a partir de TODOS los datos del producto (artículo + ficha).
 * Usado por el preview de publicación para "Completar con IA".
 *
 * Usa perfiles de prompt separados (título / descripción) + bloque anti-alucinación.
 */

import { OpenAI } from 'openai';
import { ANTI_HALLUCINATION_BLOCK } from './ai-guard';
import { loadPromptProfile } from './prompt-profiles';
import { getAIConfig } from './ai-config';
import { sanitizeAndScoreMeliTitle, rankMeliTitleCandidates } from './meli-ai-helper';

const AI_CFG = getAIConfig();
const MODEL = AI_CFG.model;

export interface ListingContentInput {
    nombre: string;
    marca: string;
    modelo: string;
    variante?: string;
    categoria?: string;
    descripcion?: string;
    atributos_especificos?: any;
    bullet_points?: string[];
    palabras_clave?: string[];
    materiales?: string;
    peso_kg?: number;
    largo_cm?: number;
    ancho_cm?: number;
    alto_cm?: number;
    pais_origen?: string;
    codigo_universal?: string;
}

export interface ListingContentOutput {
    title: string;
    family_name: string;
    title_candidates?: string[];
    description: string;
    ai_used: boolean;
    tokens_used?: number;
}

function buildUser(input: ListingContentInput): string {
    return `Datos del producto:
- Nombre: ${input.nombre}
- Marca: ${input.marca}
- Modelo: ${input.modelo}
- Variante: ${input.variante || '—'}
- Categoría: ${input.categoria || '—'}
- Descripción: ${(input.descripcion || '').slice(0, 1000) || '—'}
- Materiales: ${input.materiales || '—'}
- Peso (kg): ${input.peso_kg ?? '—'}
- Medidas (cm): ${input.largo_cm ?? '—'} x ${input.ancho_cm ?? '—'} x ${input.alto_cm ?? '—'}
- País de origen: ${input.pais_origen || '—'}
- Código universal (EAN/UPC): ${input.codigo_universal || '—'}
- Atributos específicos: ${input.atributos_especificos ? JSON.stringify(input.atributos_especificos).slice(0, 500) : '—'}
- Bullets actuales: ${(input.bullet_points || []).join('; ') || '—'}`;
}

export async function generateListingContent(
    input: ListingContentInput,
    context?: { marketplace_id?: string | null; categoria?: string | null },
): Promise<ListingContentOutput> {
    const titleProfile = await loadPromptProfile('title', context);
    const descProfile = await loadPromptProfile('description', context);
    const maxChars = Math.max(20, titleProfile.max_chars || 60);
    const minTarget = Math.max(45, maxChars - 6);
    const includeBrand = titleProfile.include_brand !== false;
    const includeModel = titleProfile.include_model === true;
    const sanitizeOpts = {
        maxChars,
        marca: input.marca,
        modelo: input.modelo,
        includeBrand,
        includeModel,
    };

    const rawFallback = [input.nombre, includeBrand ? input.marca : ''].filter(Boolean).join(' ');
    const fallbackTitle = sanitizeAndScoreMeliTitle(rawFallback, sanitizeOpts).text
        || input.nombre.slice(0, maxChars).trim();
    const fallback: ListingContentOutput = {
        title: fallbackTitle,
        family_name: fallbackTitle,
        title_candidates: fallbackTitle ? [fallbackTitle] : [],
        description: input.descripcion || '',
        ai_used: false,
    };

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('placeholder')) {
        return fallback;
    }

    const openai = new OpenAI({
        apiKey: AI_CFG.apiKey,
        baseURL: AI_CFG.baseURL,
    });
    const user = buildUser(input);

    let titleCandidates: string[] = [];
    let bestTitle = fallbackTitle;
    let description = fallback.description;
    let tokensUsed = 0;

    // 1) Título (3 candidatos optimizados entre 54 y maxChars caracteres)
    try {
        const titleInstruction = `${ANTI_HALLUCINATION_BLOCK}

${titleProfile.system_prompt}

REGLAS ESTRICTAS DE FORMATO:
- Genera 3 candidatos distintos en "title_candidates", cada uno entre ${minTarget} y ${maxChars} caracteres INCLUYENDO ESPACIOS (máximo ${maxChars}, sin cortar palabras).
- ${includeBrand ? 'Incluye la marca UNA sola vez al final (evita duplicarla si ya viene en el nombre).' : 'NO incluyas la marca.'}
- ${includeModel ? 'Incluye el modelo si aporta valor.' : 'NUNCA uses modelo, SKU ni códigos internos.'}
- Pulgadas siempre con '' (dos apóstrofos), nunca con comilla doble (").
Responde SOLO JSON sin markdown:
{ "title": "mejor candidato", "title_candidates": ["opción 1", "opción 2", "opción 3"] }`;

        const r = await openai.chat.completions.create({
            model: MODEL,
            temperature: titleProfile.temperature,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: titleInstruction },
                { role: 'user', content: user },
            ],
        });
        let rawText = r.choices[0].message.content || '{}';
        rawText = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        const raw = JSON.parse(rawText);
        const rawList = [
            ...(Array.isArray(raw.title_candidates) ? raw.title_candidates : []),
            raw.title,
            raw.family_name,
        ];
        titleCandidates = rankMeliTitleCandidates(rawList, sanitizeOpts);
        bestTitle = titleCandidates[0] || fallbackTitle;
        tokensUsed += r.usage?.total_tokens ?? 0;
    } catch (err: any) {
        console.error('[listing-ai] Fallo en título:', err.message);
    }

    // 2) Descripción
    try {
        const r = await openai.chat.completions.create({
            model: MODEL,
            temperature: descProfile.temperature,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: `${ANTI_HALLUCINATION_BLOCK}\n\n${descProfile.system_prompt}` },
                { role: 'user', content: user },
            ],
        });
        const raw = JSON.parse(r.choices[0].message.content || '{}');
        description = String(raw.description || fallback.description).trim().slice(0, descProfile.max_chars || 2000);
        tokensUsed += r.usage?.total_tokens ?? 0;
    } catch (err: any) {
        console.error('[listing-ai] Fallo en descripción:', err.message);
    }

    const ai_used = bestTitle !== fallback.title || description !== fallback.description;
    return {
        title: bestTitle,
        family_name: bestTitle,
        title_candidates: titleCandidates.length > 0 ? titleCandidates : (bestTitle ? [bestTitle] : []),
        description,
        ai_used,
        tokens_used: tokensUsed,
    };
}
