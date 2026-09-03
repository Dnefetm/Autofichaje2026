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

export async function generateListingContent(input: ListingContentInput): Promise<ListingContentOutput> {
    const fallbackTitle = [input.marca, input.nombre].filter(Boolean).join(' ').slice(0, 60);
    const fallback = {
        title: fallbackTitle,
        family_name: input.nombre.slice(0, 50),
        description: input.descripcion || '',
        ai_used: false,
    };

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('placeholder')) {
        return fallback;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const user = buildUser(input);

    // Perfiles independientes: título y descripción
    const titleProfile = await loadPromptProfile('title');
    const descProfile = await loadPromptProfile('description');

    let title = fallback.title;
    let description = fallback.description;
    let tokensUsed = 0;

    // 1) Título
    try {
        const r = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: titleProfile.temperature,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: `${ANTI_HALLUCINATION_BLOCK}\n\n${titleProfile.system_prompt}` },
                { role: 'user', content: user },
            ],
        });
        const raw = JSON.parse(r.choices[0].message.content || '{}');
        title = String(raw.title || fallback.title).trim().slice(0, titleProfile.max_chars || 60);
        tokensUsed += r.usage?.total_tokens ?? 0;
    } catch (err: any) {
        console.error('[listing-ai] Fallo en título:', err.message);
    }

    // 2) Descripción
    try {
        const r = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
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

    const ai_used = title !== fallback.title || description !== fallback.description;
    return {
        title,
        family_name: title.slice(0, 50),
        description,
        ai_used,
        tokens_used: tokensUsed,
    };
}
