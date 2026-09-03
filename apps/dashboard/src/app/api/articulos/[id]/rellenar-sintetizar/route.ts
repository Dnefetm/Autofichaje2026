import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { MAPEO_CAMPOS } from '@/lib/rellenar-ficha';

export const runtime = 'nodejs';
export const maxDuration = 30;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * POST /api/articulos/[id]/rellenar-sintetizar
 * Body: { campo, label, valor_actual, valor_ficha }
 * Sintetiza UN campo de texto fusionando el valor actual del artículo con el de la
 * ficha técnica. Usa gpt-4o-mini (barato) con contexto mínimo. No guarda nada.
 * Devuelve { sugerencia } para que el operador la acepte/rechace.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const campo = body?.campo as string | undefined;
  const label = (body?.label as string | undefined) || campo;
  const valorActual = body?.valor_actual ?? '';
  const valorFicha = body?.valor_ficha ?? '';

  const sintetizables = new Set(MAPEO_CAMPOS.filter((m) => m.sintetizable).map((m) => m.articulo));
  if (!campo || !sintetizables.has(campo)) {
    return NextResponse.json({ error: 'Campo no sintetizable' }, { status: 400 });
  }

  const prompt = `Eres un editor de catálogo de productos industriales/ferretería. Produce el mejor valor para el campo "${label}" fusionando la información del artículo y su ficha técnica.

CAMPO: ${label}
VALOR ACTUAL (artículo): ${valorActual || '(vacío)'}
VALOR FICHA TÉCNICA: ${valorFicha || '(vacío)'}

Reglas:
- Si el campo es "Descripción": redacta un texto claro, técnico y conciso (máx 300 caracteres) que conserve los datos importantes de ambos.
- Si es "Nombre": nombre comercial corto y buscable (máx 100 caracteres).
- Si es "Materiales": lista los materiales principales separados por coma, normalizados.
- Si es "Categoría" o "Variante": un valor corto y consistente.
- No inventes datos que no estén presentes. No agregues comillas ni explicaciones.

Responde SOLO con el valor final del campo.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 300,
    });
    const sugerencia = completion.choices[0]?.message?.content?.trim() || '';
    return NextResponse.json({ ok: true, sugerencia });
  } catch (err: any) {
    return NextResponse.json({ error: `Error de LLM: ${err?.message || 'desconocido'}` }, { status: 500 });
  }
}
