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

function decodeEntities(s: string): string {
    return s
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&ndash;/gi, '–')
        .replace(/&mdash;/gi, '—')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#8211;/gi, '–')
        .replace(/\s+/g, ' ')
        .trim();
}

function textoSinTags(s: string): string {
    return decodeEntities(s.replace(/<[^>]+>/g, ' '));
}

/** Atributos de WooCommerce en JSON-LD (pa_*): tipo de respaldo, adhesivo, familias, usos, etc. */
function extraerJsonLdAtributos(html: string): Record<string, string> {
    const out: Record<string, string> = {};
    const scripts = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const m of scripts) {
        try {
            const data = JSON.parse(m[1]);
            const nodes = Array.isArray(data) ? data : (data?.['@graph'] || [data]);
            for (const node of nodes) {
                const props = node?.additionalProperty;
                if (!Array.isArray(props)) continue;
                for (const pr of props) {
                    const name = String(pr?.name || '').replace(/^pa_/, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
                    const val = String(pr?.value || '').trim();
                    if (name && val && !out[name.toLowerCase()]) out[name.toLowerCase()] = val;
                }
            }
        } catch {
            /* JSON-LD inválido: ignorar */
        }
    }
    return out;
}

/** Pares clave/valor de todas las tablas HTML (especificaciones técnicas + usos). */
function extraerParesTabla(html: string): { clave: string; valor: string }[] {
    const pares: { clave: string; valor: string }[] = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    for (const trm of html.matchAll(trRe)) {
        const celdas = [...trm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
            .map((x) => textoSinTags(x[1]))
            .filter((c) => c !== '');
        if (celdas.length === 2 && celdas[0] && celdas[1]) {
            if (!pares.some((p) => p.clave.toLowerCase() === celdas[0].toLowerCase())) {
                pares.push({ clave: celdas[0], valor: celdas[1] });
            }
        }
    }
    return pares;
}

/** Medidas disponibles (sección "Medidas" de la ficha). */
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

        // atributos estructurados (para trazabilidad / vitrina)
        const atributos: Record<string, string> = {};
        for (const [k, v] of Object.entries(atributosJsonLd)) atributos[k] = v;
        for (const pr of pares) if (!atributos[pr.clave.toLowerCase()]) atributos[pr.clave] = pr.valor;

        // descripción rica: intro + usos (og) + especificaciones + medidas
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
