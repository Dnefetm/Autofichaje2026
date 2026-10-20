import { ProveedorWebAdapter, EnriquecimientoWeb } from './proveedor-web';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

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
 * Urrea — busca por código/SKU en urrea.com (Magento). Extracción con regex nativa.
 */
export const urreaWebAdapter: ProveedorWebAdapter = {
    nombre: 'Urrea Herramientas',
    async buscar(p): Promise<EnriquecimientoWeb | null> {
        const codigo = (p.codigo || '').trim();
        if (!codigo) return null;

        const url = `https://urrea.com/catalogsearch/result/?q=${encodeURIComponent(codigo)}`;
        let html: string | null = null;
        try {
            const r = await fetch(url, { headers: { 'User-Agent': UA } });
            if (r.ok) html = await r.text();
        } catch {
            html = null;
        }
        if (!html) return null;

        const fichaUrl = html.match(/class="product-item-link"[^>]*href="([^"]+)"/i)?.[1] || null;
        const imagen = extraerImagenProducto(html);

        if (!fichaUrl && !imagen) return null;
        return { imagen, urlFicha: fichaUrl };
    },
};
