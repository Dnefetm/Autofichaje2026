import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 30;

// POST /api/fichas/[id]/combinar
// Recibe { campo, label, valor_actual, valor_nuevo }
// Usa GPT para sintetizar ambos valores en uno solo sin redundancias.
// Retorna { valor_combinado } para preview editable en el modal.
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Body JSON requerido' }, { status: 400 });

    const { campo, label, valor_actual, valor_nuevo } = body as {
        campo: string;
        label: string;
        valor_actual?: string;
        valor_nuevo: string;
    };

    if (!valor_nuevo) return NextResponse.json({ error: 'valor_nuevo requerido' }, { status: 400 });

    // Si el actual está vacío, devolver el nuevo directamente (sin LLM)
    if (!valor_actual) {
        return NextResponse.json({ valor_combinado: valor_nuevo });
    }

    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const prompt = `Eres un redactor experto en fichas técnicas de productos industriales.
Te dan DOS versiones del campo "${label}" para el mismo producto.
Tu tarea: crear UNA versión que integre TODA la información única de ambas, sin repetir datos ni cambiar el significado.

Reglas:
- Elimina redundancias (si ambas dicen lo mismo con distintas palabras, quedarte con la forma más técnica/precisa)
- Incorpora información complementaria de ambas versiones
- Mantén un tono técnico-comercial
- No agregues información que no esté en ninguna de las dos versiones
- Responde SOLO con el texto resultante, sin explicaciones ni comillas envolventes

VERSIÓN A (actual en catálogo):
${valor_actual}

VERSIÓN B (extraída de nuevo documento):
${valor_nuevo}`;

        const response = await openai.chat.completions.create({
            model:       'gpt-4o-mini',
            temperature: 0.3,
            max_tokens:  800,
            messages: [{ role: 'user', content: prompt }],
        });

        const combinado = response.choices[0].message.content?.trim() ?? valor_nuevo;
        return NextResponse.json({ valor_combinado: combinado });

    } catch (err: any) {
        return NextResponse.json({ error: err?.message || 'Error al combinar con IA' }, { status: 500 });
    }
}
