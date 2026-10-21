import { ProveedorWebAdapter, EnriquecimientoWeb } from './proveedor-web';
import { fetchHtml, decodeEntities, textoSinTags, extraerJsonLdAtributos, extraerParesTabla } from './html-utils';

/** Medidas disponibles (sección "Medidas" de la ficha Tuk). */
function extraerMedidas(html: string): string | null {
    const m = html.match(/Medidas[\s\S]{0,120}?<p[^>]*>([\s\S]*?)<\/p>/i);
    if (!m) return null;
    const v = textoSinTags(m[1]);
    return v || null;
}

/**
 * Tuk — busca por TIPO (categoria2), la clave real en tuk.com.mx.
 * Extracción completa (regex nativa): og:image + og:description + tablas de
 * especificaciones/usos + atributos JSON-LD + medidas disponibles.
 */
export const tukWebAdapter: ProveedorWebAdapter = {
    nombre: 'Tuk',
    async buscar(p): Promise<EnriquecimientoWeb | null> {
        const tipo = (p.categoria2 || '').trim();
        if (!tipo) return null;

        const searchUrl = `https://tuk.com.mx/?s=${encodeURIComponent(tipo)}&post_type=product`;
        const html = await fetchHtml(searchUrl);
        if (!html) return null;

        const hrefs = [...html.matchAll(/href="(https:\/\/tuk\.com\.mx\/product\/[^"]+)"/g)].map((m) => m[1]);
        const links = hrefs.map((href) => ({ href, slug: href.split('/').filter(Boolean).pop() || '' }));
        if (!links.length) return null;

        const tok = tipo.toLowerCase();
        const fam = (p.categoria1 || '').toLowerCase();
        const exacto = links.find((l) => l.slug.split('-').includes(tok));
        const porFamilia = links.find((l) => fam && l.slug.includes(fam));
        const best = exacto || porFamilia || links[0];

        const ficha = await fetchHtml(best.href);
        if (!ficha) return { urlFicha: best.href };

        const ogImg = ficha.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1] || null;
        const ogDesc = decodeEntities(ficha.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i)?.[1] || '');

        const atributosJsonLd = extraerJsonLdAtributos(ficha);
        const pares = extraerParesTabla(ficha);
        const medidas = extraerMedidas(ficha);

        const atributos: Record<string, string> = {};
        for (const [k, v] of Object.entries(atributosJsonLd)) atributos[k] = v;
        for (const pr of pares) if (!atributos[pr.clave.toLowerCase()]) atributos[pr.clave] = pr.valor;

        const secciones: string[] = [];
        if (ogDesc) secciones.push(ogDesc);
        if (pares.length) {
            secciones.push('ESPECIFICACIONES:\n' + pares.map((pr) => `• ${pr.clave}: ${pr.valor}`).join('\n'));
        }
        if (medidas) secciones.push('MEDIDAS DISPONIBLES: ' + medidas);

        return {
            imagen: ogImg,
            descripcionLarga: secciones.join('\n\n'),
            atributos: Object.keys(atributos).length ? atributos : undefined,
            urlFicha: best.href,
        };
    },
};
