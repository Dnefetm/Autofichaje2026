import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/fichas/[id]/imagenes/extract-url
 *
 * Dada una URL de página web (ficha técnica, página de producto, catálogo PDF),
 * usa GPT-4o-mini con visión para identificar y extraer URLs de imágenes del producto.
 * El usuario luego selecciona cuáles guardar — nada se auto-guarda.
 *
 * Body: { url: string }
 * Response: { ok: true, imagenes: Array<{ url, descripcion, confianza }> }
 */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Patrones típicos de imágenes de producto que NO son iconos/logos/UI
const SKIP_PATTERNS = [
    /favicon/i, /logo\.(svg|png|ico)/i, /icon\.(svg|png)/i,
    /pixel\.gif/i, /tracking/i, /analytics/i, /banner/i,
    /\.css\?/i, /spinner/i, /loading/i,
];

function isLikelyProductImage(url: string): boolean {
    return !SKIP_PATTERNS.some(p => p.test(url));
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const body = await req.json().catch(() => null);
    const url: string = body?.url;

    if (!url || !url.startsWith('http')) {
        return NextResponse.json({ ok: false, error: 'Se requiere una URL válida (http...)' }, { status: 400 });
    }

    // ── Paso 1: Descargar HTML de la página ──────────────────────────────────
    let html: string;
    try {
        const resp = await fetch(url, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductImageBot/1.0)' },
        });
        if (!resp.ok) throw new Error(`La URL respondió ${resp.status}`);
        html = await resp.text();
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: `No se pudo acceder a la URL: ${err.message}` }, { status: 400 });
    }

    // ── Paso 2: Extraer todas las URLs de imágenes del HTML ──────────────────
    const BASE = new URL(url);
    const imageUrlSet = new Set<string>();

    // <img src="..."> y <img data-src="...">
    const imgRegex = /<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = imgRegex.exec(html)) !== null) {
        try {
            const abs = new URL(m[1], BASE).href;
            if (isLikelyProductImage(abs)) imageUrlSet.add(abs);
        } catch { /* URL malformada */ }
    }

    // <meta og:image>
    const ogRegex = /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
    while ((m = ogRegex.exec(html)) !== null) {
        try {
            const abs = new URL(m[1], BASE).href;
            imageUrlSet.add(abs); // og:image siempre es relevante
        } catch { /* skip */ }
    }

    // Datos JSON-LD (schema.org)
    const jsonLdRegex = /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    while ((m = jsonLdRegex.exec(html)) !== null) {
        try {
            const data = JSON.parse(m[1]);
            const images = data.image || data.images || [];
            const arr = Array.isArray(images) ? images : [images];
            for (const img of arr) {
                const imgUrl = typeof img === 'string' ? img : img?.url || img?.contentUrl;
                if (imgUrl) {
                    const abs = new URL(imgUrl, BASE).href;
                    imageUrlSet.add(abs);
                }
            }
        } catch { /* JSON inválido */ }
    }

    const candidatas = [...imageUrlSet].slice(0, 30); // máx 30 para no saturar el prompt

    if (candidatas.length === 0) {
        return NextResponse.json({
            ok: true,
            imagenes: [],
            advertencia: 'No se encontraron imágenes en la página. Verifica que la URL sea una página de producto.',
        });
    }

    // ── Paso 3: GPT-4o-mini filtra y clasifica las imágenes ─────────────────
    const prompt = `Eres un experto en catálogos de productos industriales y herramientas.
Se te dan ${candidatas.length} URLs de imágenes extraídas de una página web de producto.
Tu tarea: identificar cuáles son IMÁGENES DEL PRODUCTO (vistas del artículo, distintos ángulos, 
detalles técnicos, imagen de packaging). Descartar iconos, banners, logos y elementos de UI.

Para cada URL que sea imagen de producto, indica:
- url: la URL exacta (copia textual, sin modificar)
- descripcion: descripción breve de qué se ve (ej: "Vista frontal", "Detalle de rosca", "Embalaje")
- confianza: porcentaje (0-100) de que sea imagen útil del produto

Devuelve un array JSON con hasta 12 imágenes de producto, ordenadas de mayor a menor confianza.
Si la URL parece inaccesible o no es una imagen real, omítela.

URLs candidatas:
${candidatas.map((u, i) => `${i + 1}. ${u}`).join('\n')}

Responde SOLO con el array JSON, sin texto adicional. Ejemplo:
[{"url": "https://...", "descripcion": "Vista frontal del producto", "confianza": 95}]`;

    let imagenesSeleccionadas: any[] = [];
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 2000,
        });
        const raw = completion.choices[0]?.message?.content?.trim() || '[]';
        // Extraer JSON del response
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            imagenesSeleccionadas = JSON.parse(jsonMatch[0]);
        }
    } catch {
        // Fallback: devolver todas las candidatas sin clasificación
        imagenesSeleccionadas = candidatas.slice(0, 12).map(u => ({
            url: u,
            descripcion: 'Imagen del producto',
            confianza: 50,
        }));
    }

    // Filtrar por confianza mínima y limpiar estructura
    const resultado = imagenesSeleccionadas
        .filter(img => img?.url && img.confianza >= 40)
        .slice(0, 12)
        .map(img => ({
            url:         img.url,
            descripcion: img.descripcion || 'Imagen del producto',
            confianza:   Math.min(100, Math.max(0, parseInt(img.confianza) || 50)),
        }));

    return NextResponse.json({
        ok: true,
        imagenes: resultado,
        candidatas_analizadas: candidatas.length,
    });
}
