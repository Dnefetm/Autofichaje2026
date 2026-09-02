/**
 * listing-ai.ts — Generador de contenido de publicación (título + descripción)
 * con GPT-4o-mini a partir de TODOS los datos del producto (artículo + ficha).
 * Usado por el preview de publicación para "Completar con IA".
 */

import { OpenAI } from 'openai';

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
    title: string;       // título completo (marca + modelo + descriptivo) para legacy
    family_name: string; // nombre descriptivo sin marca/modelo para UP
    description: string;  // descripción de venta con bullets
    ai_used: boolean;
    tokens_used?: number;
}

export async function generateListingContent(input: ListingContentInput): Promise<ListingContentOutput> {
    const fallback = {
        title: [input.marca, input.modelo, input.nombre].filter(Boolean).join(' ').slice(0, 60),
        family_name: input.nombre.slice(0, 50),
        description: input.descripcion || '',
        ai_used: false,
    };

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('placeholder')) {
        return fallback;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const system = `Eres un redactor experto de publicaciones para MercadoLibre México (ferretería industrial).
A partir de los datos técnicos del producto, genera:
1. "title": título completo (MÁXIMO 60 caracteres incluyendo espacios) con esta fórmula EXACTA:
   nombre del producto + características principales en orden descendente de prioridad (tipo, medida, material, acabado) + marca.
   NO uses el modelo. Usa el máximo de caracteres sin pasarte de 60.
   Ejemplo: "Juego de puntas y dados de impacto 33 piezas 1/2 pulgada Cr-V Urrea".
2. "family_name": nombre descriptivo SIN marca ni modelo (máx 50 chars), para modelo User Products.
3. "description": descripción de venta en texto plano, con 4-8 bullets "•" de beneficios/características, y al final una línea de ficha técnica (medidas, peso, material, país de origen si existen). Máx 2000 chars. NO inventes datos que no estén en la entrada.

Responde SOLO JSON:
{ "title": "...", "family_name": "...", "description": "..." }`;

    const user = `Datos del producto:
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
- Atributos específicos: ${input.atributos_especificos ? JSON.stringify(input.atributos_especificos).slice(0, 5000) : '—'}
- Bullets actuales: ${(input.bullet_points || []).join('; ') || '—'}`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.3,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
        });
        const raw = JSON.parse(response.choices[0].message.content || '{}');
        return {
            title: String(raw.title || fallback.title).slice(0, 60),
            family_name: String(raw.family_name || fallback.family_name).slice(0, 50),
            description: String(raw.description || fallback.description).slice(0, 2000),
            ai_used: true,
            tokens_used: response.usage?.total_tokens,
        };
    } catch (err: any) {
        console.error('[listing-ai] Fallo GPT-4o-mini:', err.message);
        return fallback;
    }
}
