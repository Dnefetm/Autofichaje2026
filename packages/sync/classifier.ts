/**
 * classifier.ts — Clasificador de productos de ferretería
 * Adaptado del legacy fichas-tecnicas-automatizacion/app/api/classify/route.ts
 * Ajustado a los campos reales de la tabla `articulos` en Autofichaje2026
 */

import { OpenAI } from 'openai';

// --- Taxonomía de ferretería --------------------------------------------------

export const TAXONOMY: Record<string, string[]> = {
    'Herramientas Manuales':        ['Abrasivos', 'Corte', 'Destornilladores', 'Llaves', 'Alicates', 'Golpe', 'Medición'],
    'Herramientas Eléctricas':      ['Taladros', 'Esmeriles', 'Sierras', 'Inalámbrica', 'Lijadoras', 'Accesorios'],
    'Seguridad Industrial EPP':     ['Pies', 'Manos', 'Respiratoria', 'Visual', 'Auditiva', 'Ropa'],
    'Ferretería y Fijaciones':      ['Tornillería', 'Pijas', 'Anclajes', 'Cerrajería', 'Herrajes', 'Cadenas'],
    'Construcción y Acabados':      ['Adhesivos', 'Impermeabilizantes', 'Pinturas', 'Construcción Ligera', 'Polvos'],
    'Iluminación y Material Eléctrico': ['Interior', 'Exterior', 'Conductores', 'Artefactos', 'Distribución'],
    'Plomería y Gas':               ['Tubería', 'Grifería', 'Gas', 'Bombas', 'Calentadores'],
    'Automotriz':                   ['Herramienta Mecánica', 'Gatos', 'Baterías', 'Limpieza', 'Fluidos'],
    'Hogar y Jardín':               ['Maquinaria', 'Riego', 'Ventilación', 'Organización', 'Limpieza'],
    'Maquinaria Ligera':            ['Generadores', 'Compresores', 'Soldadoras', 'Construcción Ligera', 'Lavado a Presión'],
};

export const CATEGORIES = Object.keys(TAXONOMY);

// --- Tipos --------------------------------------------------------------------

export interface ClassificationResult {
    category: string;
    subcategory: string;
    confidence_category: number;  // 0-1
}

// --- Prompt del clasificador --------------------------------------------------

function buildClassifyPrompt(): string {
    const cats = CATEGORIES.map((cat) => {
        const subs = TAXONOMY[cat].join(', ');
        return `- ${cat}: [${subs}]`;
    }).join('\n');

    return `Eres un clasificador experto en ferretería industrial y productos de construcción.
Dado el texto de un producto, determina su categoría y subcategoría.

Categorías disponibles (formato "Categoría: [subcategorías]"):
${cats}

Responde SOLO con JSON sin markdown:
{
  "category": "<categoría exacta>",
  "subcategory": "<subcategoría exacta>",
  "confidence_category": <número 0.0-1.0>
}

Si el producto no encaja claramente en ninguna categoría, usa la más cercana con confidence_category bajo.`;
}

// --- Función principal --------------------------------------------------------

/**
 * Clasifica un producto de ferretería dado su texto OCR o descripción.
 * Usa gpt-4o-mini a temperatura 0.1 — la taxonomía es determinista.
 */
export async function classifyProduct(text: string): Promise<ClassificationResult> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Truncar a 20K chars — para clasificación no necesitamos el texto completo
    const context = text.slice(0, 20_000);

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.1,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: buildClassifyPrompt() },
                { role: 'user',   content: `Clasifica este producto:\n\n${context}` },
            ],
        });

        const raw = JSON.parse(response.choices[0].message.content || '{}');

        // Validar que la categoría sea de la taxonomía
        const category = CATEGORIES.includes(raw.category) ? raw.category : 'Herramientas Manuales';
        const subcategories = TAXONOMY[category];
        const subcategory = subcategories.includes(raw.subcategory) ? raw.subcategory : subcategories[0];

        return {
            category,
            subcategory,
            confidence_category: typeof raw.confidence_category === 'number'
                ? Math.min(1, Math.max(0, raw.confidence_category))
                : 0.7,
        };
    } catch {
        // Si falla la clasificación, no bloquear el flujo principal
        return {
            category:            'Herramientas Manuales',
            subcategory:         'Medición',
            confidence_category: 0,
        };
    }
}

// --- Prompts especializados por categoría -------------------------------------

/**
 * Retorna los campos adicionales a extraer según la categoría detectada.
 * Se usa para enriquecer el prompt principal de autoficha.ts en Fase 2.
 */
export function getCategoryExtraFields(category: string): string {
    const extras: Record<string, string> = {
        'Herramientas Manuales':
            'longitud_mm, material_mango, dureza_punta, norma_calidad (DIN/ISO/ANSI)',
        'Herramientas Eléctricas':
            'voltaje_v, potencia_w, rpm_max, chuck_mm, diametro_disco_mm, tipo_bateria',
        'Seguridad Industrial EPP':
            'norma_proteccion (EN/ANSI/NOM), nivel_proteccion, talla, certificacion',
        'Ferretería y Fijaciones':
            'diametro_mm, longitud_mm, rosca, tipo_cabeza, material, finish (zinc/galvanizado/negro)',
        'Construcción y Acabados':
            'rendimiento_m2_l, tiempo_secado_h, resistencia_mpa, base (agua/solvente)',
        'Iluminación y Material Eléctrico':
            'lumens, temperatura_color_k, voltaje_v, potencia_w, ip_rating, tipo_lampara',
        'Plomería y Gas':
            'diametro_pulg, presion_maxima_psi, material_cuerpo, tipo_conexion',
        'Automotriz':
            'viscosidad, capacidad_toneladas, tipo_bateria, ah, cca',
        'Hogar y Jardín':
            'caudal_l_h, presion_bar, potencia_w, capacidad_l',
        'Maquinaria Ligera':
            'potencia_kw, capacidad_l, presion_max_psi, frecuencia_hz, motor',
    };

    return extras[category] || '';
}
