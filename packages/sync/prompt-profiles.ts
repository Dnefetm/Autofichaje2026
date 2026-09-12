/**
 * prompt-profiles.ts — Perfiles de prompts ("voz de marca") para la IA de publicación.
 *
 * Un perfil tiene una capa SIMPLE (instrucción en lenguaje natural + toggles) y,
 * opcionalmente, un `system_prompt` crudo como "modo experto". El prompt final se
 * compila en runtime cuando no hay override experto. El bloque anti-alucinación se
 * antepone SIEMPRE en código (ai-guard.ts) y no es editable desde aquí.
 *
 * Herencia en cascada (escalabilidad): override por cuenta/categoría > default global.
 */

import { supabase } from '@gestor/shared/lib/supabase';

export interface PromptProfile {
    name: string;
    system_prompt: string;
    temperature: number;
    max_chars: number;
    instructions?: string | null;
    tone?: string | null;
    length_pref?: string | null;
    include_measures?: boolean;
    include_brand?: boolean;
    include_model?: boolean;
    include_material?: boolean;
    language?: string;
}

export interface PromptContext {
    marketplace_id?: string | null;
    categoria?: string | null;
}

export const DEFAULT_TITLE_PROFILE: PromptProfile = {
    name: 'Título por defecto',
    system_prompt: `Eres un redactor experto en títulos para MercadoLibre México (ferretería/herramientas).
Genera un "title" de MÁXIMO 60 caracteres INCLUYENDO ESPACIOS, con esta fórmula EXACTA:
nombre del producto + características principales en orden de prioridad (tipo, medida, material, acabado) + marca.
NO uses el modelo. Usa el máximo de caracteres sin pasarte de 60.
Responde SOLO JSON: { "title": "..." }`,
    temperature: 0.3,
    max_chars: 60,
};

export const DEFAULT_DESCRIPTION_PROFILE: PromptProfile = {
    name: 'Descripción por defecto',
    system_prompt: `Eres un redactor experto en descripciones de venta para MercadoLibre México (ferretería/herramientas).
Genera una "description" en texto plano con 4-8 bullets "•" de beneficios/características REALES y, al final, una línea de ficha técnica (medidas, peso, material, país de origen SOLO si existen en los datos de entrada).
NO inventes datos que no estén en la entrada.
Responde SOLO JSON: { "description": "..." }`,
    temperature: 0.3,
    max_chars: 2000,
};

/** Compila la capa simple (instrucciones + toggles) en un system_prompt. */
export function compileProfilePrompt(
    p: {
        instructions?: string | null;
        tone?: string | null;
        length_pref?: string | null;
        include_measures?: boolean;
        include_brand?: boolean;
        include_model?: boolean;
        include_material?: boolean;
        language?: string;
    },
    scope: 'title' | 'description',
): string {
    const instruction = (p.instructions || '').trim();
    const lines: string[] = [];
    if (instruction) lines.push(`Instrucciones de estilo:\n${instruction}`);
    if (p.tone) lines.push(`- Tono: ${p.tone}.`);
    if (p.length_pref) lines.push(`- Extensión: ${p.length_pref}.`);

    const incl: string[] = [];
    if (p.include_measures) incl.push('medidas');
    if (p.include_brand) incl.push('marca');
    if (p.include_model) incl.push('modelo');
    if (p.include_material) incl.push('material');
    if (incl.length) lines.push(`- Incluye: ${incl.join(', ')}.`);
    if (p.language) lines.push(`- Idioma: ${p.language}.`);

    if (scope === 'title') {
        return `Eres un redactor experto en títulos para MercadoLibre México.
${lines.join('\n')}
Responde SOLO JSON: { "title": "..." }`;
    }
    return `Eres un redactor experto en descripciones de venta para MercadoLibre México.
${lines.join('\n')}
Usa bullets "•" y NO inventes datos que no estén en la entrada.
Responde SOLO JSON: { "description": "..." }`;
}

function toProfile(row: any, fallback: PromptProfile): PromptProfile {
    return {
        name: row?.name || fallback.name,
        system_prompt: row?.system_prompt || compileProfilePrompt(row, fallback === DEFAULT_TITLE_PROFILE ? 'title' : 'description'),
        temperature: Number(row?.temperature ?? fallback.temperature),
        max_chars: Number(row?.max_chars ?? fallback.max_chars),
        instructions: row?.instructions ?? null,
        tone: row?.tone ?? null,
        length_pref: row?.length_pref ?? null,
        include_measures: row?.include_measures,
        include_brand: row?.include_brand,
        include_model: row?.include_model,
        include_material: row?.include_material,
        language: row?.language ?? null,
    };
}

/** Puntaje de especificidad de un override frente al contexto (3 exacto, 2 categoría, 1 cuenta, 0 ninguno). */
function overrideScore(o: any, ctx: PromptContext): number {
    const m = ctx.marketplace_id ?? null;
    const c = ctx.categoria ?? null;
    const om = o.marketplace_id ?? null;
    const oc = o.categoria ?? null;
    if (m && om === m && c && oc === c) return 3;
    if (c && oc === c && !om) return 2;
    if (m && om === m && !oc) return 1;
    return 0;
}

/** Carga el perfil default (is_default) para un ámbito. */
async function loadDefaultProfile(scope: 'title' | 'description', fallback: PromptProfile): Promise<PromptProfile> {
    const { data, error } = await supabase
        .from('prompt_profiles')
        .select('name, system_prompt, temperature, max_chars, instructions, tone, length_pref, include_measures, include_brand, include_model, include_material, language')
        .eq('scope', scope)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error || !data) return fallback;
    return toProfile(data, fallback);
}

/**
 * Resuelve el perfil activo para un ámbito, aplicando herencia en cascada:
 * override (cuenta+categoría) > override (categoría) > override (cuenta) > default global.
 */
export async function resolvePromptProfile(scope: 'title' | 'description', context?: PromptContext): Promise<PromptProfile> {
    const fallback = scope === 'title' ? DEFAULT_TITLE_PROFILE : DEFAULT_DESCRIPTION_PROFILE;
    try {
        if (context && (context.marketplace_id || context.categoria)) {
            const { data: ovs } = await supabase
                .from('prompt_profile_overrides')
                .select('marketplace_id, categoria, prompt_profiles(name, system_prompt, temperature, max_chars, instructions, tone, length_pref, include_measures, include_brand, include_model, include_material, language, is_active)')
                .eq('scope', scope)
                .limit(50);

            let best: any = null;
            let bestScore = 0;
            for (const o of (ovs || [])) {
                const profRaw: any = o.prompt_profiles;
                const prof = Array.isArray(profRaw) ? profRaw[0] : profRaw;
                if (!prof || prof.is_active === false) continue;
                const s = overrideScore(o, context);
                if (s > bestScore) { bestScore = s; best = o; }
            }
            if (best) {
                const profRaw: any = best.prompt_profiles;
                const prof = Array.isArray(profRaw) ? profRaw[0] : profRaw;
                if (prof) return toProfile(prof, fallback);
            }
        }
        return await loadDefaultProfile(scope, fallback);
    } catch {
        return fallback;
    }
}

/** Compatibilidad: sin contexto (usa el default global). */
export async function loadPromptProfile(scope: 'title' | 'description'): Promise<PromptProfile> {
    return resolvePromptProfile(scope);
}

/** Lista todos los perfiles de un ámbito (para el editor). */
export async function listPromptProfiles(scope: 'title' | 'description'): Promise<any[]> {
    try {
        const { data, error } = await supabase
            .from('prompt_profiles')
            .select('*')
            .eq('scope', scope)
            .order('is_default', { ascending: false })
            .order('name', { ascending: true });
        if (error) return [];
        return data || [];
    } catch {
        return [];
    }
}
