import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SKIP_PATTERNS = [
    /favicon/i, /logo/i, /icon/i, /sprite/i, /placeholder/i,
    /pixel\.gif/i, /tracking/i, /analytics/i, /banner/i,
    /\.css\?/i, /spinner/i, /loading/i,
    /visa/i, /mastercard/i, /master[-_]?card/i, /maestro/i, /amex/i,
    /american[-_]?express/i, /paypal/i, /oxxo/i, /mercado[-_]?pago/i,
    /payment/i, /\bpago/i, /\bpay\b/i,
    /whatsapp/i, /facebook/i, /instagram/i, /tiktok/i, /youtube/i,
    /twitter/i, /linkedin/i, /pinterest/i, /telegram/i, /\bsocial\b/i,
    /\bmail\b/i, /email/i, /arroba/i,
    /flag[-_]/i, /badge/i, /seal/i, /ssl/i, /secure/i,
];

function isLikelyProductImage(url: string): boolean {
    if (url.startsWith('data:')) return false;
    return !SKIP_PATTERNS.some((p) => p.test(url));
}

export async function POST(req: NextRequest) {
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
                'Accept-Language': 'es-MX,es;q=0.9,en;q=0.7',
            },
        });
        if (!resp.ok) throw new Error(`La URL respondió ${resp.status}`);
        html = await resp.text();
    } catch (err: any) {
        return NextResponse.json({ ok: false, error: `No se pudo acceder a la URL: ${err.message}` }, { status: 400 });
    }

    const $ = cheerio.load(html);
    const BASE = new URL(url);
    const resolveUrl = (src: string) => {
        try { return new URL(src, BASE).href; } catch { return null; }
    };
    const decodeNextImage = (raw: string): string => {
        if (raw.includes('/_next/image?url=')) {
            try {
                const u = new URL(raw);
                const encoded = u.searchParams.get('url');
                if (encoded) { const r = resolveUrl(encoded); if (r) return r; }
            } catch {}
        }
        return raw;
    };

    // Normaliza a tamaño completo: quita redimensionados de Magento (/cache/{hash}/),
    // Shopify (?width=/?height=), y parámetros w/h comunes.
    const toFullSize = (raw: string): string => {
        let u = raw.replace(/\/cache\/[0-9a-f]{6,}\//i, '/');
        try {
            const p = new URL(u);
            ['width', 'height', 'w', 'h'].forEach(k => p.searchParams.delete(k));
            u = p.toString();
        } catch {}
        return u;
    };

    const primary = new Set<string>();
    $('meta[property="og:image"], meta[name="og:image"]').each((_, el) => {
        const c = $(el).attr('content');
        if (c) { const r = resolveUrl(c); if (r) primary.add(decodeNextImage(r)); }
    });
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const data = JSON.parse($(el).html() || '{}');
            const nodes = Array.isArray(data) ? data : [data];
            for (const node of nodes) {
                const images = node?.image || node?.images || [];
                const arr = Array.isArray(images) ? images : [images];
                for (const img of arr) {
                    const imgUrl = typeof img === 'string' ? img : img?.url || img?.contentUrl;
                    if (imgUrl) { const r = resolveUrl(imgUrl); if (r) primary.add(decodeNextImage(r)); }
                }
            }
        } catch {}
    });

    // Atributos comunes de galerías de producto (Magento/fotorama, Shopify, WooCommerce, custom)
    const IMG_ATTRS = ['src', 'data-src', 'data-lazy-src', 'data-zoom-image', 'data-large', 'data-large-image', 'data-image', 'data-original', 'data-full', 'data-full-image', 'data-gallery-image', 'data-main-image'];

    const secondary = new Set<string>();
    $('img').each((_, el) => {
        for (const attr of IMG_ATTRS) {
            const v = $(el).attr(attr);
            if (v) { const r = resolveUrl(v); if (r) secondary.add(decodeNextImage(r)); }
        }
        const srcset = $(el).attr('srcset');
        if (srcset) {
            for (const part of srcset.split(',')) {
                const u = part.trim().split(' ')[0];
                if (u) { const r = resolveUrl(u); if (r) secondary.add(decodeNextImage(r)); }
            }
        }
    });
    // <picture><source srcset> (imágenes responsive)
    $('picture source').each((_, el) => {
        const srcset = $(el).attr('srcset');
        if (srcset) {
            for (const part of srcset.split(',')) {
                const u = part.trim().split(' ')[0];
                if (u) { const r = resolveUrl(u); if (r) secondary.add(decodeNextImage(r)); }
            }
        }
    });
    // Enlaces <a href> a imagen (galerías que envuelven miniaturas con link a la foto grande)
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (/\.(jpe?g|png|webp)(\?|$)/i.test(href)) {
            const r = resolveUrl(href);
            if (r) secondary.add(decodeNextImage(r));
        }
    });

    // Descartar miniaturas/íconos por patrón en la URL (no bloquea la foto grande real)
    const THUMB_PATTERNS = [/thumb/i, /thumbnail/i, /small/i, /mini/i, /[-_]\d{2,3}x\d{2,3}[-_.]/i, /w_\d{1,3}[,_]/i, /h_\d{1,3}[,_]/i];
    function isThumb(url: string): boolean {
        return THUMB_PATTERNS.some((p) => p.test(url));
    }

    // Por cada candidato, proponer su versión a tamaño completo y la original;
    // quedarnos con la completa y descartar el redimensionado de Magento (/cache/).
    const rawCandidatas = [...new Set([...primary, ...secondary])].filter(isLikelyProductImage);
    const candidatas = [...new Set(rawCandidatas.flatMap(u => [toFullSize(u), u]))]
        .filter(u => !isThumb(u))
        .filter(u => !/\/cache\/[0-9a-f]{6,}\//i.test(u))
        .slice(0, 60);

    const validImages: string[] = [];
    for (const imgUrl of candidatas) {
        try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 3000);
            const head = await fetch(imgUrl, { method: 'HEAD', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
            clearTimeout(id);
            if (head.ok) {
                const ct = head.headers.get('content-type');
                if (ct && ct.startsWith('image/')) validImages.push(imgUrl);
            } else if (head.status === 405 || head.status === 403) {
                validImages.push(imgUrl);
            }
        } catch {}
    }

    if (validImages.length === 0) {
        return NextResponse.json({ ok: true, imagenes: [], advertencia: 'No se encontraron imágenes de producto en la página.' });
    }

    return NextResponse.json({
        ok: true,
        imagenes: validImages.slice(0, 15).map((imgUrl, i) => ({ url: imgUrl, descripcion: `Imagen ${i + 1}`, confianza: i === 0 ? 99 : 80 })),
    });
}
