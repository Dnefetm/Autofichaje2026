import { ProveedorWebAdapter, EnriquecimientoWeb } from './proveedor-web';
import { fetchHtml, textoSinTags, extraerParesTabla } from './html-utils';

function limpiarImagen(src: string): string | null {
    if (!src) return null;
    if (src.includes('placeholder')) return null; // placeholder de Magento
    return src.split('?')[0]; // quitar resize/compresión
}

/** Extrae la primera imagen real (no placeholder) de una etiqueta img de producto. */
function extraerImagenProducto(html: string): string | null {
    const imgRe = /<img[^>]+product-image-photo[^>]*>/gi;
    for (const m of html.matchAll(imgRe)) {
        const src = m[0].match(/(?:src|data-src)="([^"]+)"/i)?.[1];
        const limpia = src ? limpiarImagen(src) : null;
        if (limpia) return limpia;
    }
    return null;
}

/**
 * Urrea — busca por código/SKU en urrea.com (Magento).
 * Abre la ficha individual y extrae el nombre + tabla de especificaciones ("Más información").
 */
export const urreaWebAdapter: ProveedorWebAdapter = {
    nombre: 'Urrea Herramientas',
    async buscar(p): Promise<EnriquecimientoWeb | null> {
        const codigo = (p.codigo || '').trim();
        if (!codigo) return null;

        const searchUrl = `https://urrea.com/catalogsearch/result/?q=${encodeURIComponent(codigo)}`;
        const html = await fetchHtml(searchUrl);
        if (!html) return null;

        const fichaUrl = html.match(/class="product-item-link"[^>]*href="([^"]+)"/i)?.[1] || null;
        const imagen = extraerImagenProducto(html);

        let titulo: string | null = null;
        const atributos: Record<string, string> = {};

        if (fichaUrl) {
            const ficha = await fetchHtml(fichaUrl);
            if (ficha) {
                const t = textoSinTags(ficha.match(/<title>([^<]+)<\/title>/i)?.[1] || '');
                titulo = t ? t.split('|')[0].trim() : null;
                const pares = extraerParesTabla(ficha);
                for (const pr of pares) if (!atributos[pr.clave.toLowerCase()]) atributos[pr.clave] = pr.valor;
            }
        }

        const secciones: string[] = [];
        if (titulo) secciones.push(titulo);
        if (Object.keys(atributos).length) {
            secciones.push('ESPECIFICACIONES:\n' + Object.entries(atributos).map(([k, v]) => `• ${k}: ${v}`).join('\n'));
        }

        if (!fichaUrl && !imagen) return null;
        return {
            imagen,
            descripcionLarga: secciones.join('\n\n') || null,
            atributos: Object.keys(atributos).length ? atributos : undefined,
            urlFicha: fichaUrl,
        };
    },
};
