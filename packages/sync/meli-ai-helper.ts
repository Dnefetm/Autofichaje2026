/**
 * meli-ai-helper.ts — Asistente GPT-4o-mini para publicaciones en MercadoLibre
 * Package: @gestor/sync (ya tiene openai como dependencia)
 *
 * Resuelve:
 *   1. family_name / title — orientado por el perfil de "voz de marca" (scope 'title')
 *   2. attributes[] — valores para atributos requeridos faltantes (anti-alucinación FIJA)
 *   3. description (solo si rephrase_description) — orientado por perfil (scope 'description')
 *
 * El bloque anti-alucinación se antepone SIEMPRE en código y no es editable.
 */

import { OpenAI } from 'openai';
import { ANTI_HALLUCINATION_BLOCK } from './ai-guard';
import { resolvePromptProfile, PromptContext, PromptProfile } from './prompt-profiles';

// --- Tipos --------------------------------------------------------------------

export interface MeliAttributeOption {
    id: string;
    name: string;
}

export interface MeliUnresolvedAttribute {
    id: string;          // ej: "WRENCH_TYPE"
    name: string;        // ej: "Tipo de llave"
    value_type: string;  // "list" | "string" | "number" | etc.
    values: MeliAttributeOption[];  // opciones disponibles (solo para type="list")
}

export interface MeliAIHelperInput {
    nombre: string;
    marca: string;
    modelo: string;
    descripcion?: string;
    atributos_especificos?: any;   // JSON libre del artículo
    unresolved_attributes: MeliUnresolvedAttribute[];
    max_family_name_chars?: number; // default 50
    legacy?: boolean;               // true: title completo (marca+modelo); false: family_name sin marca/modelo
    rephrase_description?: boolean; // true: descripción ligeramente reformulada (copia adaptada)
}

export interface MeliAIHelperOutput {
    family_name: string;
    title: string;
    attributes: Array<{ id: string; value_id?: string; value_name?: string }>;
    description?: string;
    ai_used: boolean;
    tokens_used?: number;
    profiles?: { title: string; description: string };
}

// --- Prompt ------------------------------------------------------------------

/** Directriz de estilo editable de un perfil (simple o experto). */
function profileStyle(p: PromptProfile): string {
    // Modo experto: system_prompt crudo sin instrucciones → se usa tal cual.
    if (p.system_prompt && !p.instructions) return p.system_prompt;
    const lines: string[] = [];
    if (p.instructions) lines.push(p.instructions);
    if (p.tone) lines.push(`Tono: ${p.tone}.`);
    if (p.length_pref) lines.push(`Extensión: ${p.length_pref}.`);
    const incl: string[] = [];
    if (p.include_measures) incl.push('medidas');
    if (p.include_brand) incl.push('marca');
    if (p.include_model) incl.push('modelo');
    if (p.include_material) incl.push('material');
    if (incl.length) lines.push(`Incluye: ${incl.join(', ')}.`);
    if (p.language) lines.push(`Idioma: ${p.language}.`);
    return lines.join('\n');
}

function buildPrompt(input: MeliAIHelperInput, titleStyle: string, descStyle: string): { system: string; user: string } {
    const maxChars = input.max_family_name_chars ?? 50;
    const legacy = input.legacy === true;

    const tituloField = legacy
        ? `"title": "título comercial (MÁXIMO ${maxChars} caracteres INCLUYENDO ESPACIOS; fórmula: producto + características + marca, SIN modelo)"`
        : `"family_name": "nombre descriptivo (MÁXIMO ${maxChars} caracteres INCLUYENDO ESPACIOS, SIN marca ni modelo)"`;

    const tituloRule = legacy
        ? `1. Generar un "title" comercial de MÁXIMO ${maxChars} caracteres INCLUYENDO ESPACIOS, con esta fórmula EXACTA:
   nombre del producto + características principales en orden descendente de prioridad (tipo, medida, material, acabado) + marca.
   NO uses el modelo. Usa el máximo de caracteres sin pasarte de ${maxChars}.
   Ejemplo: "Juego de puntas y dados de impacto 33 piezas 1/2 pulgada Urrea".`
        : `1. Generar un "family_name" descriptivo de MÁXIMO ${maxChars} caracteres INCLUYENDO ESPACIOS:
   nombre del producto + características principales (tipo, medida, material).
   SIN marca ni modelo — MercadoLibre (User Products) los agrega automáticamente al título visible.`;

    const styleBlock = titleStyle
        ? `\n   Directrices de estilo de la marca (OBLIGATORIAS para redactar):\n${titleStyle.split('\n').map(l => '   ' + l).join('\n')}`
        : '';

    const descTask = input.rephrase_description
        ? `\n3. Reescribe la "description" del producto de forma ligeramente distinta a la original (máximo 2000 caracteres),
   conservando TODA la información útil y las características, pero con redacción y estructura diferentes.${descStyle ? `\n   Directrices de estilo:\n${descStyle.split('\n').map(l => '   ' + l).join('\n')}` : ''}`
        : '';

    const descJsonField = input.rephrase_description
        ? `,\n  "description": "descripción reformulada (máx 2000 caracteres)"`
        : '';

    const system = `${ANTI_HALLUCINATION_BLOCK}

Eres un experto en redacción de títulos y clasificación de atributos para MercadoLibre México.

Tus tareas:
${tituloRule}${styleBlock}
2. Para cada atributo requerido sin valor, seleccionar el más apropiado de la lista de opciones.
   - Usa el nombre completo del producto (Nombre, Descripción, Atributos específicos) para elegir.
   - Elige el valor cuyo significado coincide MÁS PRECISAMENTE con el producto real, no con la categoría general.
   - Ejemplo correcto: "Llave ajustable" → tipo "Francesa/Ajustable", NO "Combinada" ni "Tubular".
   - Si el atributo es de tipo "string" o "number" y no tiene lista, genera un valor apropiado.
   - NUNCA inventes un value_id; usa exactamente el id de la opción que elijas de la lista.${descTask}

Responde SOLO con JSON sin markdown:
{
  ${tituloField},
  "attributes": [
    { "id": "ATRIBUTO_ID", "value_id": "id_seleccionado", "value_name": "nombre_seleccionado" }
  ]${descJsonField}
}`;

    const attrsBlock = input.unresolved_attributes.map(attr => {
        if (attr.values.length > 0) {
            const opts = attr.values.map(v => `${v.name} (id: ${v.id})`).join(', ');
            return `- ${attr.id} ("${attr.name}"): [${opts}]`;
        }
        return `- ${attr.id} ("${attr.name}"): valor libre tipo ${attr.value_type}`;
    }).join('\n');

    const user = `Producto:
  Nombre: ${input.nombre}
  Marca: ${input.marca}
  Modelo: ${input.modelo}
  Descripción: ${input.descripcion?.slice(0, 500) || 'No disponible'}
  Atributos específicos: ${input.atributos_especificos ? JSON.stringify(input.atributos_especificos).slice(0, 3000) : 'No disponibles'}

Atributos requeridos sin resolver:
${attrsBlock || 'Ninguno — solo generar el family_name'}`;

    return { system, user };
}

// --- Función principal --------------------------------------------------------

/**
 * resolvePublicationAI — Genera family_name/title + atributos (+ descripción).
 * El título y la descripción se orientan por los perfiles de "voz de marca".
 * Nunca lanza excepción: si el AI falla, retorna fallback sin atributos AI.
 */
export async function resolvePublicationAI(input: MeliAIHelperInput, context?: PromptContext): Promise<MeliAIHelperOutput> {
    const maxChars = input.max_family_name_chars ?? 50;
    const legacy = input.legacy === true;

    const familyNameFallback = input.nombre.slice(0, maxChars).trim();
    const titleFallback = [input.marca, input.modelo, input.nombre]
        .filter(Boolean).join(' ').slice(0, maxChars).trim();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('placeholder')) {
        return { family_name: familyNameFallback, title: titleFallback, attributes: [], ai_used: false };
    }

    // Perfiles de "voz de marca" (con herencia por cuenta/categoría).
    const titleProfile = await resolvePromptProfile('title', context);
    const descProfile = await resolvePromptProfile('description', context);

    const { system, user } = buildPrompt(input, profileStyle(titleProfile), profileStyle(descProfile));

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        });

        const raw = JSON.parse(response.choices[0].message.content || '{}');
        const tokensUsed = response.usage?.total_tokens;

        let family_name = (raw.family_name || familyNameFallback).toString().trim();
        let title = (raw.title || titleFallback).toString().trim();
        if (legacy) {
            if (title.length > maxChars) title = title.slice(0, maxChars).trim();
        } else {
            if (family_name.length > maxChars) family_name = family_name.slice(0, maxChars).trim();
        }

        const attributes: Array<{ id: string; value_id?: string; value_name?: string }> =
            Array.isArray(raw.attributes) ? raw.attributes.filter((a: any) => a?.id) : [];

        const description = input.rephrase_description && typeof raw.description === 'string'
            ? raw.description.trim().slice(0, 5000)
            : undefined;

        return {
            family_name,
            title,
            attributes,
            description,
            ai_used: true,
            tokens_used: tokensUsed,
            profiles: { title: titleProfile.name, description: descProfile.name },
        };
    } catch (err: any) {
        console.error('[meli-ai-helper] Fallo en GPT-4o-mini:', err.message);
        return {
            family_name: familyNameFallback,
            title: titleFallback,
            attributes: [],
            ai_used: false,
            profiles: { title: titleProfile.name, description: descProfile.name },
        };
    }
}
