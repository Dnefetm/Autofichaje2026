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

    const secondary = new Set<string>();
    $('img').each((_, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        if (src) { const r = resolveUrl(src); if (r) secondary.add(decodeNextImage(r)); }
        const srcset = $(el).attr('srcset');
        if (srcset) {
            for (const part of srcset.split(',')) {
                const u = part.trim().split(' ')[0];
                if (u) { const r = resolveUrl(u); if (r) secondary.add(decodeNextImage(r)); }
            }
        }
    });

    const candidatas = [...new Set([...primary, ...secondary])]
        .filter(isLikelyProductImage)
        .slice(0, 50);

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
