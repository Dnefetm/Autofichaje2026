import { ProveedorWebAdapter, EnriquecimientoWeb } from './proveedor-web';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

async function fetchHtml(url: string): Promise<string | null> {
    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!r.ok) return null;
        return await r.text();
    } catch {
        return null;
    }
}

/**
 * Tuk — busca por TIPO (categoria2), la clave real en tuk.com.mx.
 * Extracción con regex nativa (sin cheerio): enlaces de producto + og:image/og:description.
 */
export const tukWebAdapter: ProveedorWebAdapter = {
    nombre: 'Tuk',
    async buscar(p): Promise<EnriquecimientoWeb | null> {
        const tipo = (p.categoria2 || '').trim();
        if (!tipo) return null;

        const searchUrl = `https://tuk.com.mx/?s=${encodeURIComponent(tipo)}&post_type=product`;
        const html = await fetchHtml(searchUrl);
        if (!html) return null;

        // Enlaces de producto (deduplicados por href)
        const hrefs = [...html.matchAll(/href="(https:\/\/tuk\.com\.mx\/product\/[^"]+)"/g)].map((m) => m[1]);
        const links = hrefs.map((href) => ({ href, slug: href.split('/').filter(Boolean).pop() || '' }));
        if (!links.length) return null;

        // Desempatar: token EXACTO de categoria2, luego subcadena de categoria1.
        const tok = tipo.toLowerCase();
        const fam = (p.categoria1 || '').toLowerCase();
        const exacto = links.find((l) => l.slug.split('-').includes(tok));
        const porFamilia = links.find((l) => fam && l.slug.includes(fam));
        const best = exacto || porFamilia || links[0];

        const ficha = await fetchHtml(best.href);
        if (!ficha) return { urlFicha: best.href };

        const ogImg = ficha.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1] || null;
        const ogDesc = ficha.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1] || null;
        return { imagen: ogImg, descripcionLarga: ogDesc, urlFicha: best.href };
    },
};
