/**
 * prompt-profiles.ts — Perfiles de prompts para la IA de publicación.
 *
 * Hay DOS ámbitos independientes: 'title' y 'description'. Cada uno tiene su
 * propio conjunto de perfiles (globales). El bloque anti-alucinación se antepone
 * SIEMPRE en código (ai-guard.ts) y no es editable desde aquí.
 */

import { supabase } from '@gestor/shared/lib/supabase';

export interface PromptProfile {
    name: string;
    system_prompt: string;
    temperature: number;
    max_chars: number;
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

/**
 * Carga el perfil activo (preferentemente el default) para un ámbito.
 * Si la tabla no existe o no hay perfiles, devuelve el default embebido.
 */
export async function loadPromptProfile(scope: 'title' | 'description'): Promise<PromptProfile> {
    const fallback = scope === 'title' ? DEFAULT_TITLE_PROFILE : DEFAULT_DESCRIPTION_PROFILE;
    try {
        const { data, error } = await supabase
            .from('prompt_profiles')
            .select('name, system_prompt, temperature, max_chars')
            .eq('scope', scope)
            .eq('is_active', true)
            .order('is_default', { ascending: false })
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (error || !data) return fallback;
        return {
            name: data.name,
            system_prompt: data.system_prompt || fallback.system_prompt,
            temperature: Number(data.temperature ?? fallback.temperature),
            max_chars: Number(data.max_chars ?? fallback.max_chars),
        };
    } catch {
        return fallback;
    }
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
