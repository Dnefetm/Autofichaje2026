// Helpers HTML compartidos por los adapters web (Tuk/WooCommerce, Urrea/Magento, etc.).
// Sin dependencias externas: fetch nativo + regex.

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

export async function fetchHtml(url: string): Promise<string | null> {
    try {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!r.ok) return null;
        return await r.text();
    } catch {
        return null;
    }
}

export function decodeEntities(s: string): string {
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

export function textoSinTags(s: string): string {
    return decodeEntities(s.replace(/<[^>]+>/g, ' '));
}

/** Atributos de WooCommerce en JSON-LD (pa_*): tipo de respaldo, adhesivo, familias, usos, etc. */
export function extraerJsonLdAtributos(html: string): Record<string, string> {
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
export function extraerParesTabla(html: string): { clave: string; valor: string }[] {
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
