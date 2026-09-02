/**
 * meli-ai-helper.ts — Asistente GPT-4o-mini para publicaciones en MercadoLibre
 * Package: @gestor/sync (ya tiene openai como dependencia)
 *
 * Resuelve con una sola llamada al AI:
 *   1. family_name — título limpio sin marca ni modelo (MeLi los agrega automáticamente)
 *   2. attributes[] — valores para los atributos requeridos que no se mapearon automáticamente
 *
 * Patrón idéntico a classifier.ts: gpt-4o-mini, temperatura 0.1, response_format json_object.
 */

import { OpenAI } from 'openai';

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
    max_family_name_chars?: number; // default 50 — para no superar 60 al agregar marca+modelo
    legacy?: boolean;               // true: genera title completo (marca+modelo); false: family_name sin marca/modelo
}

export interface MeliAIHelperOutput {
    family_name: string;
    title: string;                  // título completo para modelo legacy
    attributes: Array<{ id: string; value_id?: string; value_name?: string }>;
    ai_used: boolean;      // false si se usó el fallback sin AI
    tokens_used?: number;
}

// --- Prompt ------------------------------------------------------------------

function buildPrompt(input: MeliAIHelperInput): { system: string; user: string } {
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

    const system = `Eres un experto en redacción de títulos y clasificación de atributos para MercadoLibre México.

Tus tareas:
${tituloRule}
2. Para cada atributo requerido sin valor, seleccionar el más apropiado de la lista de opciones.
   - Usa el nombre completo del producto (Nombre, Descripción, Atributos específicos) para elegir.
   - Elige el valor cuyo significado coincide MÁS PRECISAMENTE con el producto real, no con la categoría general.
   - Ejemplo correcto: "Llave ajustable" → tipo "Francesa/Ajustable", NO "Combinada" ni "Tubular".
   - Si el atributo es de tipo "string" o "number" y no tiene lista, genera un valor apropiado.
   - NUNCA inventes un value_id; usa exactamente el id de la opción que elijas de la lista.

Responde SOLO con JSON sin markdown:
{
  ${tituloField},
  "attributes": [
    { "id": "ATRIBUTO_ID", "value_id": "id_seleccionado", "value_name": "nombre_seleccionado" }
  ]
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
 * resolvePublicationAI — Genera family_name y resuelve atributos requeridos faltantes.
 *
 * Si no hay atributos sin resolver, igual genera el family_name limpio.
 * Si la llamada al AI falla, retorna un fallback con nombre truncado y sin atributos AI.
 * Nunca lanza excepción — el flujo de publicación no debe romperse por el AI.
 */
export async function resolvePublicationAI(input: MeliAIHelperInput): Promise<MeliAIHelperOutput> {
    const maxChars = input.max_family_name_chars ?? 50;
    const legacy = input.legacy === true;

    // Fallbacks sin AI
    const familyNameFallback = input.nombre.slice(0, maxChars).trim();
    const titleFallback = [input.marca, input.modelo, input.nombre]
        .filter(Boolean)
        .join(' ')
        .slice(0, maxChars)
        .trim();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    if (!process.env.OPENAI_API_KEY) {
        return {
            family_name: familyNameFallback,
            title:       titleFallback,
            attributes:  [],
            ai_used:     false,
        };
    }

    const { system, user } = buildPrompt(input);

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user',   content: user },
            ],
        });

        const raw = JSON.parse(response.choices[0].message.content || '{}');
        const tokensUsed = response.usage?.total_tokens;

        // Validar y limpiar el campo de título según el modo
        let family_name = (raw.family_name || familyNameFallback).toString().trim();
        let title = (raw.title || titleFallback).toString().trim();
        if (legacy) {
            if (title.length > maxChars) title = title.slice(0, maxChars).trim();
            // En legacy, family_name no se usa; lo dejamos como fallback del nombre descriptivo
        } else {
            if (family_name.length > maxChars) family_name = family_name.slice(0, maxChars).trim();
        }

        // Filtrar atributos que tengan al menos id
        const attributes: Array<{ id: string; value_id?: string; value_name?: string }> =
            Array.isArray(raw.attributes)
                ? raw.attributes.filter((a: any) => a?.id)
                : [];

        return {
            family_name,
            title,
            attributes,
            ai_used: true,
            tokens_used: tokensUsed,
        };
    } catch (err: any) {
        // No bloquear la publicación si el AI falla
        console.error('[meli-ai-helper] Fallo en GPT-4o-mini:', err.message);
        return {
            family_name: familyNameFallback,
            title:       titleFallback,
            attributes:  [],
            ai_used:     false,
        };
    }
}
