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

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
}

export interface MeliAIHelperOutput {
    family_name: string;
    attributes: Array<{ id: string; value_id?: string; value_name?: string }>;
    ai_used: boolean;      // false si se usó el fallback sin AI
    tokens_used?: number;
}

// ─── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt(input: MeliAIHelperInput): { system: string; user: string } {
    const maxChars = input.max_family_name_chars ?? 50;

    const system = `Eres un experto en redacción de títulos y clasificación de atributos para MercadoLibre México.
MercadoLibre en modelo "User Products" agrega automáticamente la marca y el modelo al título visible.
Por eso el campo "family_name" NO debe incluir la marca ni el modelo.

Tus tareas:
1. Generar un "family_name" descriptivo, máximo ${maxChars} caracteres, SIN marca ni modelo.
   Debe describir claramente el producto (tipo, función, tamaño, material si aplica).
2. Para cada atributo requerido sin valor, seleccionar el más apropiado de la lista de opciones.
   Si el atributo es de tipo "string" o "number" y no tiene lista, generar un valor apropiado.

Responde SOLO con JSON sin markdown:
{
  "family_name": "...",
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
  Atributos específicos: ${input.atributos_especificos ? JSON.stringify(input.atributos_especificos).slice(0, 300) : 'No disponibles'}

Atributos requeridos sin resolver:
${attrsBlock || 'Ninguno — solo generar el family_name'}`;

    return { system, user };
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * resolvePublicationAI — Genera family_name y resuelve atributos requeridos faltantes.
 *
 * Si no hay atributos sin resolver, igual genera el family_name limpio.
 * Si la llamada al AI falla, retorna un fallback con nombre truncado y sin atributos AI.
 * Nunca lanza excepción — el flujo de publicación no debe romperse por el AI.
 */
export async function resolvePublicationAI(input: MeliAIHelperInput): Promise<MeliAIHelperOutput> {
    const maxChars = input.max_family_name_chars ?? 50;

    // Fallback sin AI: nombre truncado directo
    const familyNameFallback = input.nombre.slice(0, maxChars).trim();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    if (!process.env.OPENAI_API_KEY) {
        return {
            family_name: familyNameFallback,
            attributes: [],
            ai_used: false,
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

        // Validar y limpiar family_name
        let family_name = (raw.family_name || familyNameFallback).toString().trim();
        if (family_name.length > maxChars) {
            family_name = family_name.slice(0, maxChars).trim();
        }

        // Filtrar atributos que tengan al menos id
        const attributes: Array<{ id: string; value_id?: string; value_name?: string }> =
            Array.isArray(raw.attributes)
                ? raw.attributes.filter((a: any) => a?.id)
                : [];

        return {
            family_name,
            attributes,
            ai_used: true,
            tokens_used: tokensUsed,
        };
    } catch (err: any) {
        // No bloquear la publicación si el AI falla
        console.error('[meli-ai-helper] Fallo en GPT-4o-mini:', err.message);
        return {
            family_name: familyNameFallback,
            attributes: [],
            ai_used: false,
        };
    }
}
