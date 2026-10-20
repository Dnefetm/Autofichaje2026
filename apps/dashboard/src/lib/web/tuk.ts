import { load } from 'cheerio';
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
 * Tuk — busca por TIPO (categoria2), que es la clave real en tuk.com.mx.
 * WordPress hace match por subcadena, por eso se desempata por token exacto.
 */
export const tukWebAdapter: ProveedorWebAdapter = {
    nombre: 'Tuk',
    async buscar(p): Promise<EnriquecimientoWeb | null> {
        const tipo = (p.categoria2 || '').trim();
        if (!tipo) return null;

        const searchUrl = `https://tuk.com.mx/?s=${encodeURIComponent(tipo)}&post_type=product`;
        const html = await fetchHtml(searchUrl);
        if (!html) return null;

        const $ = load(html);
        const links: { href: string; slug: string }[] = [];
        $('a[href*="/product/"]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            const slug = href.split('/').filter(Boolean).pop() || '';
            if (!links.some((l) => l.href === href)) links.push({ href, slug });
        });
        if (!links.length) return null;

        // Desempatar: token EXACTO de categoria2, luego subcadena de categoria1.
        const tok = tipo.toLowerCase();
        const fam = (p.categoria1 || '').toLowerCase();
        const exacto = links.find((l) => l.slug.split('-').includes(tok));
        const porFamilia = links.find((l) => fam && l.slug.includes(fam));
        const best = exacto || porFamilia || links[0];

        const ficha = await fetchHtml(best.href);
        if (!ficha) return { urlFicha: best.href };

        const $f = load(ficha);
        return {
            imagen: $f('meta[property="og:image"]').attr('content') || null,
            descripcionLarga: $f('meta[property="og:description"]').attr('content') || null,
            urlFicha: best.href,
        };
    },
};
