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
import { getAIConfig } from './ai-config';

const AI_CFG = getAIConfig();
const MODEL = AI_CFG.model;

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
    variante?: string | null;
    categoria?: string | null;
    descripcion?: string;
    materiales?: string | null;
    peso_kg?: number | null;
    largo_cm?: number | null;
    ancho_cm?: number | null;
    alto_cm?: number | null;
    pais_origen?: string | null;
    unidades_pack?: number | null;
    bullet_points?: string[];
    resolved_attributes?: Array<{ id: string; name?: string; value_name?: string }>;
    atributos_especificos?: any;   // JSON libre del artículo
    unresolved_attributes: MeliUnresolvedAttribute[];
    max_family_name_chars?: number; // default 60
    legacy?: boolean;               // true: title completo; false: family_name
    rephrase_description?: boolean; // true: descripción ligeramente reformulada (copia adaptada)
}

export interface MeliAIHelperOutput {
    family_name: string;
    title: string;
    title_candidates?: string[];
    attributes: Array<{ id: string; value_id?: string; value_name?: string }>;
    description?: string;
    ai_used: boolean;
    tokens_used?: number;
    profiles?: {
        title: string;
        description: string;
        title_source?: string;
        description_source?: string;
        title_prompt_preview?: string;
        description_prompt_preview?: string;
    };
}

export interface TitleSanitizeOptions {
    maxChars?: number;      // default 60
    marca?: string | null;
    modelo?: string | null;
    includeBrand?: boolean; // default true
    includeModel?: boolean; // default false
}

const TRAILING_STOP_WORDS = new Set(['de', 'con', 'para', 'en', 'el', 'la', 'los', 'las', 'y', 'a', 'por', 'al', 'del', 'sin']);
const MEASURE_ONLY_RE = /^(?:\d+\/\d+|\d+(?:[./-]\d+)?\s*(?:mm|cm|m|in|''|"|pulg(?:adas?)?|g|kg|ml|l|lt|lts|w|v|hz|amp|hp|pz|pzs|piezas?))$/i;

function normToken(s: string): string {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[®™©]/g, '')
        .toLowerCase()
        .trim();
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanTitleAnnotations(raw: string): string {
    const ANOTACIONES = [
        /publicar\s+y\s+corregir/gi,
        /publicar\s+y\s+revisar/gi,
        /revisar\s+y\s+corregir/gi,
        /pendiente\s+de\s+revisi[oó]n/gi,
        /corregir\s+despu[eé]s/gi,
        /publicar.*$\*/gi,
        /\brevisar\b.*$/gi,
        /\bcorregir\b.*$/gi,
        /\bpendiente\b.*$/gi,
        /\bcheck\b.*$/gi,
    ];
    let text = String(raw || '').trim().replace(/"/g, "''");
    for (const pat of ANOTACIONES) {
        text = text.replace(pat, ' ').trim();
    }
    text = text.replace(/\s+/g, ' ').replace(/[-,/|.;:]+\s*$/, '').trim();
    return text;
}

function containsNormalizedBrand(text: string, brand: string): boolean {
    const nt = normToken(text);
    const nb = normToken(brand);
    if (!nb) return false;
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(nb)}($|[^a-z0-9])`, 'i');
    return re.test(nt);
}

function endsWithNormalizedBrand(text: string, brand: string): boolean {
    const nt = normToken(text);
    const nb = normToken(brand);
    if (!nb) return false;
    return nt === nb || nt.endsWith(` ${nb}`);
}

function trimStopWords(words: string[]): string[] {
    const out = [...words];
    while (out.length > 1 && TRAILING_STOP_WORDS.has(normToken(out[out.length - 1]))) {
        out.pop();
    }
    return out;
}

/**
 * Sanitiza un título de MercadoLibre aplicando "Título ML 60" de forma determinística:
 * pulgadas con '', sin anotaciones, sin modelo prohibido, sin marca duplicada y recorte
 * inteligente de palabras descriptivas sin partir palabras ni cortar la marca final.
 */
export function sanitizeAndScoreMeliTitle(
    raw: string,
    opts: TitleSanitizeOptions = {},
): { text: string; score: number; issues: string[] } {
    const maxChars = Math.max(20, opts.maxChars ?? 60);
    const includeBrand = opts.includeBrand !== false;
    const includeModel = opts.includeModel === true;
    const marcaTrim = String(opts.marca || '').replace(/"/g, "''").trim();
    const modeloTrim = String(opts.modelo || '').trim();
    const issues: string[] = [];

    let text = cleanTitleAnnotations(raw);
    if (!text) return { text: '', score: 0, issues: ['vacío'] };

    // Filtro anti-modelo cuando el perfil lo prohíbe (por defecto include_model = false)
    const canFilterModel = Boolean(
        !includeModel &&
        modeloTrim.length >= 3 &&
        !/^\d{1,3}$/.test(modeloTrim) &&
        normToken(modeloTrim) !== normToken(marcaTrim) &&
        !MEASURE_ONLY_RE.test(modeloTrim),
    );
    let removedModel = false;
    if (canFilterModel) {
        const modEsc = escapeRegExp(modeloTrim);
        const modRe = new RegExp(`(^|[\\s,;/\\-(]+)(?:mod(?:elo)?\\.?\\s*)?${modEsc}(?=$|[\\s,;/\\-).]+)`, 'gi');
        const next = text
            .replace(modRe, '$1')
            .replace(/\s+/g, ' ')
            .replace(/[-,/|.;:]+\s*$/, '')
            .trim();
        if (next !== text) {
            removedModel = true;
            issues.push('modelo_removido');
            text = next;
        }
    }

    // Deduplicar o agregar marca cuando includeBrand está activo
    if (includeBrand && marcaTrim) {
        const brandNorm = normToken(marcaTrim);
        const rawBrandVariants = Array.from(new Set([
            marcaTrim,
            marcaTrim.replace(/[®™©]/g, '').trim(),
            brandNorm,
        ].filter(Boolean))).sort((a, b) => b.length - a.length);

        const brandPattern = new RegExp(
            `(?:^|\\s)(?:${rawBrandVariants.map(escapeRegExp).join('|')})[®™©]*(?=$|\\s)`,
            'gi',
        );
        const matches = text.match(brandPattern) || [];
        if (matches.length > 1) {
            // Quitar ocurrencias repetidas y dejar una sola marca al final
            const stripped = text.replace(brandPattern, ' ').replace(/\s+/g, ' ').trim();
            text = stripped ? `${stripped} ${marcaTrim}` : marcaTrim;
            issues.push('marca_deduplicada');
        } else if (!containsNormalizedBrand(text, marcaTrim)) {
            if (text.length + 1 + marcaTrim.length <= maxChars) {
                text = `${text} ${marcaTrim}`.trim();
            } else {
                issues.push('sin_espacio_para_marca');
            }
        }
    }

    // Recorte inteligente sin partir palabras ni cortar la marca final
    if (text.length > maxChars) {
        issues.push('recortado');
        if (includeBrand && marcaTrim && endsWithNormalizedBrand(text, marcaTrim)) {
            const words = text.split(/\s+/).filter(Boolean);
            const brandWordCount = marcaTrim.split(/\s+/).filter(Boolean).length;
            if (words.length > brandWordCount) {
                const brandSuffix = words.slice(-brandWordCount).join(' ');
                let bodyWords = trimStopWords(words.slice(0, -brandWordCount));
                while (bodyWords.length > 1 && `${bodyWords.join(' ')} ${brandSuffix}`.length > maxChars) {
                    bodyWords.pop();
                    bodyWords = trimStopWords(bodyWords);
                }
                const combined = bodyWords.length > 0 ? `${bodyWords.join(' ')} ${brandSuffix}` : brandSuffix;
                if (combined.length <= maxChars) {
                    text = combined;
                } else {
                    const avail = maxChars - brandSuffix.length - 1;
                    text = avail >= 10
                        ? `${combined.slice(0, avail).trim()} ${brandSuffix}`
                        : combined.slice(0, maxChars).trim();
                }
            }
        }
        if (text.length > maxChars) {
            const sub = text.slice(0, maxChars);
            const lastSpace = sub.lastIndexOf(' ');
            const cut = (lastSpace > maxChars * 0.5 ? sub.slice(0, lastSpace) : sub).trim();
            const cutWords = trimStopWords(cut.split(/\s+/).filter(Boolean));
            text = cutWords.join(' ').replace(/[-,/|.;:]+\s*$/, '').trim();
        }
    }

    const len = text.length;
    const minOptimal = Math.max(40, maxChars - 6);
    let score = 0;
    if (len >= minOptimal && len <= maxChars) {
        score = 100 - (maxChars - len);
    } else if (len >= 48 && len < minOptimal) {
        score = 60 + (len - 48);
    } else {
        score = Math.max(0, len);
    }

    if (includeBrand && marcaTrim && containsNormalizedBrand(text, marcaTrim)) {
        score += 20;
    }
    if (!canFilterModel || !removedModel) {
        score += 10;
    }

    return { text, score, issues };
}

export function rankMeliTitleCandidates(
    rawCandidates: Array<string | null | undefined>,
    opts: TitleSanitizeOptions = {},
): string[] {
    const scored = new Map<string, { text: string; score: number }>();
    for (const raw of rawCandidates) {
        if (!raw || !String(raw).trim()) continue;
        const res = sanitizeAndScoreMeliTitle(String(raw), opts);
        if (!res.text) continue;
        const key = res.text.toLowerCase();
        const prev = scored.get(key);
        if (!prev || res.score > prev.score) {
            scored.set(key, { text: res.text, score: res.score });
        }
    }
    return Array.from(scored.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(x => x.text);
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

function buildPrompt(
    input: MeliAIHelperInput,
    titleProfile: PromptProfile,
    titleStyle: string,
    descStyle: string,
): { system: string; user: string } {
    const maxChars = Math.max(20, titleProfile.max_chars || input.max_family_name_chars || 60);
    const minTarget = Math.max(45, maxChars - 6);
    const includeBrand = titleProfile.include_brand !== false;
    const includeModel = titleProfile.include_model === true;
    const fieldName = input.legacy === true ? 'title' : 'family_name';

    const tituloRule = `1. Generar 3 opciones distintas de "${fieldName}" en "title_candidates" (entre ${minTarget} y ${maxChars} caracteres INCLUYENDO ESPACIOS, sin desperdiciar espacio y sin pasar de ${maxChars}):
   - Estructura: nombre del producto + característica relevante 1 + característica relevante 2 + característica relevante 3${includeBrand ? ' + marca (una sola vez al final, sin repetirla si ya venía en el nombre)' : ''}.
   - Usa palabras completas, sin cortar palabras al final.
   - Escribe el símbolo de pulgadas con '' (dos apóstrofos) en lugar de " (ej: 28-36'' en vez de 28-36").
   - ${includeModel ? 'Incluye modelo solo si aporta valor de búsqueda.' : 'NUNCA uses el modelo, SKU ni códigos internos.'}`;

    const styleBlock = titleStyle
        ? `\n   Directrices del perfil "${titleProfile.name}" (OBLIGATORIAS):\n${titleStyle.split('\n').map(l => '   ' + l).join('\n')}`
        : '';

    const descTask = input.rephrase_description
        ? `\n3. Genera la "description" del producto a partir de TODOS los datos de entrada (nombre, descripción, atributos específicos).${descStyle ? `\n   Directrices de estilo (OBLIGATORIAS):\n${descStyle.split('\n').map(l => '   ' + l).join('\n')}` : ''}`
        : '';

    const descJsonField = input.rephrase_description
        ? `,\n  "description": "descripción generada (texto plano)"`
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
  "${fieldName}": "mejor candidato (${minTarget}-${maxChars} caracteres)",
  "title_candidates": ["opción 1 (${minTarget}-${maxChars} chars)", "opción 2", "opción 3"],
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

    const resolvedAttrsText = (input.resolved_attributes || [])
        .filter(a => a?.id && a?.value_name)
        .slice(0, 25)
        .map(a => `${a.name || a.id}: ${a.value_name}`)
        .join('; ');
    const dimsParts = [
        input.largo_cm != null ? `${input.largo_cm}cm largo` : null,
        input.ancho_cm != null ? `${input.ancho_cm}cm ancho` : null,
        input.alto_cm != null ? `${input.alto_cm}cm alto` : null,
        input.peso_kg != null ? `${input.peso_kg}kg` : null,
    ].filter(Boolean);

    const user = `Producto:
  Nombre: ${input.nombre}
  Marca: ${input.marca || 'No especificada'}
  ${includeModel ? `Modelo: ${input.modelo || 'No disponible'}` : `Modelo (solo referencia interna — NO incluir en título): ${input.modelo || 'No disponible'}`}
  Variante: ${input.variante || '—'}
  Categoría: ${input.categoria || '—'}
  Unidades por pack: ${input.unidades_pack && input.unidades_pack > 1 ? input.unidades_pack : 1}
  Materiales: ${input.materiales || '—'}
  Medidas/Peso: ${dimsParts.length ? dimsParts.join(' x ') : '—'}
  País de origen: ${input.pais_origen || '—'}
  Bullets técnicos: ${input.bullet_points?.length ? input.bullet_points.join(' | ').slice(0, 800) : '—'}
  Atributos resueltos: ${resolvedAttrsText || '—'}
  Descripción: ${input.descripcion?.slice(0, 2000) || 'No disponible'}
  Atributos específicos: ${input.atributos_especificos ? JSON.stringify(input.atributos_especificos).slice(0, 2500) : 'No disponibles'}

Atributos requeridos sin resolver:
${attrsBlock || 'Ninguno — solo generar el título'}`;

    return { system, user };
}

// --- Función principal --------------------------------------------------------

/**
 * resolvePublicationAI — Genera 3 candidatos + mejor family_name/title + atributos (+ descripción).
 * El título y la descripción se orientan por los perfiles de "voz de marca" (ej. "Título ML 60").
 * Nunca lanza excepción: si el AI falla, retorna fallback sanitizado sin atributos AI.
 */
export async function resolvePublicationAI(input: MeliAIHelperInput, context?: PromptContext): Promise<MeliAIHelperOutput> {
    const requestedMax = input.max_family_name_chars ?? 60;
    const rawFallback = [input.nombre, input.marca].filter(Boolean).join(' ');
    const baseSanitizedFallback = sanitizeAndScoreMeliTitle(rawFallback, {
        maxChars: requestedMax,
        marca: input.marca,
        modelo: input.modelo,
        includeBrand: true,
        includeModel: false,
    }).text || input.nombre.slice(0, requestedMax).trim();

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('placeholder')) {
        return {
            family_name: baseSanitizedFallback,
            title: baseSanitizedFallback,
            title_candidates: baseSanitizedFallback ? [baseSanitizedFallback] : [],
            attributes: [],
            ai_used: false,
        };
    }

    const openai = new OpenAI({
        apiKey: AI_CFG.apiKey,
        baseURL: AI_CFG.baseURL,
    });

    // Perfiles de "voz de marca" (con herencia por cuenta/categoría).
    const titleProfile = await resolvePromptProfile('title', context);
    const descProfile = await resolvePromptProfile('description', context);

    const titleStyle = profileStyle(titleProfile);
    const descStyle = profileStyle(descProfile);
    const maxChars = Math.max(20, titleProfile.max_chars || input.max_family_name_chars || 60);
    const includeBrand = titleProfile.include_brand !== false;
    const includeModel = titleProfile.include_model === true;
    const sanitizeOpts: TitleSanitizeOptions = {
        maxChars,
        marca: input.marca,
        modelo: input.modelo,
        includeBrand,
        includeModel,
    };
    const sanitizedFallback = sanitizeAndScoreMeliTitle(
        [input.nombre, includeBrand ? input.marca : ''].filter(Boolean).join(' '),
        sanitizeOpts,
    ).text || input.nombre.slice(0, maxChars).trim();

    // Llamada 1: título (3 candidatos) + atributos.
    const { system: titleSystem, user: productUser } = buildPrompt(
        { ...input, rephrase_description: false },
        titleProfile,
        titleStyle,
        '',
    );

    try {
        const response = await openai.chat.completions.create({
            model: MODEL,
            temperature: titleProfile.temperature,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: titleSystem },
                { role: 'user', content: productUser },
            ],
        });

        let content = response.choices[0].message.content || '{}';
        content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
        const raw = JSON.parse(content);
        let tokensUsed = response.usage?.total_tokens ?? 0;

        const rawList: Array<string | null | undefined> = [
            ...(Array.isArray(raw.title_candidates) ? raw.title_candidates : []),
            raw.title,
            raw.family_name,
        ];
        const title_candidates = rankMeliTitleCandidates(rawList, sanitizeOpts);
        const bestTitle = title_candidates[0] || sanitizedFallback;
        const family_name = bestTitle;
        const title = bestTitle;

        const attributes: Array<{ id: string; value_id?: string; value_name?: string }> =
            Array.isArray(raw.attributes) ? raw.attributes.filter((a: any) => a?.id) : [];

        // Llamada 2: descripción (separada, con el prompt directo, no anidado).
        let description: string | undefined;
        if (input.rephrase_description) {
            try {
                const descSystem = `${ANTI_HALLUCINATION_BLOCK}\n\n${descStyle}\n\nTONO (obligatorio): escribe como una persona real, no como robot ni catálogo. Evita frases hechas de marketing como "diseñada para ofrecerte comodidad y rendimiento", "perfecta para quienes buscan", "te garantizan un rendimiento superior y duradero". Usa frases cortas, concretas y variadas.\n\nFORMATO DE SALIDA OBLIGATORIO: responde SOLO JSON con estos dos campos:\n{ "narrative": "los párrafos narrativos completos", "bullet_points": ["bullet 1", "bullet 2", "..."] }\nReglas de bullet_points (obligatorias):\n- Cada bullet es un BENEFICIO en lenguaje natural, por ejemplo "Alcanza ramas altas sin esfuerzo gracias a su longitud ajustable". NUNCA uses el formato "Campo: valor" (no escribas "Materiales: acero" ni "Identificación: ...").\n- Deriva los beneficios de los datos técnicos y de los tipos de uso del producto.\n- OMITE cualquier categoría o dato que no exista: nunca escribas "null", "vacío", "sin dato" ni inventes.\n- Entre 3 y 8 bullets.`;
                const descResp = await openai.chat.completions.create({
                    model: MODEL,
                    temperature: descProfile.temperature,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: descSystem },
                        { role: 'user', content: productUser },
                    ],
                });
                let descContent = descResp.choices[0].message.content || '{}';
                descContent = descContent.replace(/```json/gi, '').replace(/```/g, '').trim();
                const descRaw = JSON.parse(descContent);
                tokensUsed += descResp.usage?.total_tokens ?? 0;
                const narrative = typeof descRaw.narrative === 'string'
                    ? descRaw.narrative.trim()
                    : (typeof descRaw.description === 'string' ? descRaw.description.trim() : '');
                const bullets = Array.isArray(descRaw.bullet_points)
                    ? descRaw.bullet_points.map((b: any) => String(b).trim()).filter(Boolean)
                    : [];
                const bulletsBlock = bullets.length > 0
                    ? '\n\n' + bullets.map((b: string) => `• ${b}`).join('\n')
                    : '';
                description = narrative ? (narrative + bulletsBlock).slice(0, 5000) : undefined;
            } catch (descErr: any) {
                console.error('[meli-ai-helper] Fallo en descripción:', descErr.message);
            }
        }

        return {
            family_name,
            title,
            title_candidates: title_candidates.length > 0 ? title_candidates : (bestTitle ? [bestTitle] : []),
            attributes,
            description,
            ai_used: true,
            tokens_used: tokensUsed,
            profiles: {
                title: titleProfile.name,
                description: descProfile.name,
                title_source: titleProfile.source || 'fallback',
                description_source: descProfile.source || 'fallback',
                title_prompt_preview: titleStyle.slice(0, 160),
                description_prompt_preview: descStyle.slice(0, 160),
            },
        };
    } catch (err: any) {
        console.error('[meli-ai-helper] Fallo en GPT-4o-mini:', err.message);
        return {
            family_name: sanitizedFallback,
            title: sanitizedFallback,
            title_candidates: sanitizedFallback ? [sanitizedFallback] : [],
            attributes: [],
            ai_used: false,
            profiles: {
                title: titleProfile.name,
                description: descProfile.name,
                title_source: titleProfile.source || 'fallback',
                description_source: descProfile.source || 'fallback',
                title_prompt_preview: titleStyle.slice(0, 160),
                description_prompt_preview: descStyle.slice(0, 160),
            },
        };
    }
}
