import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Patrones típicos de imágenes de producto que NO son iconos/logos/UI
const SKIP_PATTERNS = [
      /favicon/i, /logo/i, /icon/i, /sprite/i,
  /pixel\.gif/i, /tracking/i, /analytics/i, /banner/i,
  /\.css\?/i, /spinner/i, /loading/i, /placeholder/i,
  // Logos de medios de pago
  /visa/i, /mastercard/i, /maestro/i, /amex/i, /american[-_]?express/i,
  /paypal/i, /oxxo/i, /mercado[-_]?pago/i, /payment/i, /pago/i,
  // Iconos de redes sociales
  /whatsapp/i, /facebook/i, /instagram/i, /tiktok/i, /youtube/i,
  /twitter/i, /linkedin/i, /pinterest/i, /telegram/i, /\bsocial\b/i,
  // Otros elementos de UI comunes
  /flag[-_]/i, /badge/i, /seal/i, /ssl/i, /secure/i, /thumb(nail)?[-_]?icon/i,
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

    let html: string;
    try {
        const resp = await fetch(url, {
            signal: AbortSignal.timeout(15_000),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'es-MX,es;q=0.9,en-US;q=0.8,en;q=0.7',
            },
        });
        if (!resp.ok) throw new Error(`La URL respondió ${resp.status}`);
        html = await resp.text();
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: `No se pudo acceder a la URL: ${err.message}` }, { status: 400 });
    }

    const $ = cheerio.load(html);
    const BASE = new URL(url);
    const imageUrlSet = new Set<string>();

    const resolveUrl = (src: string) => {
        try { return new URL(src, BASE).href; } catch { return null; }
    };

    $('img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (src) {
            const resolved = resolveUrl(src);
            if (resolved) imageUrlSet.add(resolved);
        }
        
        const srcset = $(el).attr('srcset');
        if (srcset) {
            // srcset format: "url1 1x, url2 2x, url3 3x"
            const parts = srcset.split(',');
            for (const part of parts) {
                const urlMatch = part.trim().split(' ')[0];
                if (urlMatch) {
                    const resolved = resolveUrl(urlMatch);
                    if (resolved) imageUrlSet.add(resolved);
                }
            }
        }
    });

    $('meta[property="og:image"], meta[name="og:image"]').each((_, el) => {
        const content = $(el).attr('content');
        if (content) {
            const resolved = resolveUrl(content);
            if (resolved) imageUrlSet.add(resolved);
        }
    });

    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const data = JSON.parse($(el).html() || '{}');
            const images = data.image || data.images || [];
            const arr = Array.isArray(images) ? images : [images];
            for (const img of arr) {
                const imgUrl = typeof img === 'string' ? img : img?.url || img?.contentUrl;
                if (imgUrl) {
                    const resolved = resolveUrl(imgUrl);
                    if (resolved) imageUrlSet.add(resolved);
                }
            }
        } catch {}
    });

    // Decodificar Next.js /_next/image?url=
    const finalUrls = new Set<string>();
    for (const rawUrl of imageUrlSet) {
        if (rawUrl.includes('/_next/image?url=')) {
            try {
                const u = new URL(rawUrl);
                const encoded = u.searchParams.get('url');
                if (encoded) {
                    const resolved = resolveUrl(encoded);
                    if (resolved) finalUrls.add(resolved);
                }
            } catch {}
        } else {
            finalUrls.add(rawUrl);
        }
    }

    // Filtrar patrones obvios de basura
    let candidatas = [...finalUrls].filter(isLikelyProductImage).filter(u => !u.startsWith('data:'));

    // Validar URLs con peticiones HEAD
    const validImages = [];
    for (const imgUrl of candidatas.slice(0, 50)) { // Límite para no tardar tanto
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 3000);
            const head = await fetch(imgUrl, { 
                method: 'HEAD', 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                signal: controller.signal 
            });
            clearTimeout(id);
            
            // Si la petición es exitosa y es una imagen
            if (head.ok) {
                const ct = head.headers.get('content-type');
                if (ct && ct.startsWith('image/')) {
                    validImages.push(imgUrl);
                }
            } else if (head.status === 405 || head.status === 403) {
                // Si el servidor bloquea el HEAD, asumimos que es válida por ahora para no perderla
                validImages.push(imgUrl);
            }
        } catch {
            // Ignorar timeouts
        }
    }

    if (validImages.length === 0) {
        return NextResponse.json({
            ok: true,
            imagenes: [],
            advertencia: 'No se encontraron imágenes válidas en la página. Verifica la URL.',
        });
    }

    // Devolvemos las imágenes sin pasar por LLM para asegurar que las URLs sean 100% reales
    const resultado = validImages.slice(0, 15).map((imgUrl, index) => ({
        url: imgUrl,
        descripcion: `Imagen extraída de la página (${index + 1})`,
        confianza: index === 0 ? 99 : 80, // La primera suele ser la principal
    }));

    return NextResponse.json({
        ok: true,
        imagenes: resultado,
    });
}
