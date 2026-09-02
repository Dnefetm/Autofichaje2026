/**
 * formats.ts — Política central de formatos de fuente del módulo de fichas técnicas.
 * Un único lugar para la allowlist MIME, la detección por extensión y los helpers de
 * extracción de texto sin OCR (texto plano / CSV / Markdown / HTML).
 *
 * PDF, imágenes y Office (DOCX/XLSX/PPTX) van a Azure Document Intelligence.
 * Texto plano, CSV, Markdown y HTML se extraen localmente (sin OCR) en autoficha.ts.
 */

// Formatos que el pipeline acepta como entrada.
// NOTA: los .doc/.xls/.ppt legacy NO se incluyen porque Azure prebuilt-layout no los soporta.
export const ALLOWED_MIME: string[] = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/tiff',
    'image/bmp',
    'image/heic',
    'image/heif',
    // Microsoft Office Open XML (soportados por Azure prebuilt-layout)
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // XLSX
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
    // Texto plano / HTML (extracción local, sin OCR)
    'text/plain',
    'text/csv',
    'text/markdown',
    'text/html',
];

export const EXT_TO_MIME: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.bmp': 'image/bmp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
};

export function isTextualMime(mime: string): boolean {
    return mime === 'text/plain' || mime === 'text/csv' || mime === 'text/markdown';
}

export function isHtmlMime(mime: string): boolean {
    return mime === 'text/html' || mime === 'application/xhtml+xml';
}

const HTML_ENTITIES: Record<string, string> = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&apos;': "'", '&#39;': "'",
    '&aacute;': 'á', '&eacute;': 'é', '&iacute;': 'í', '&oacute;': 'ó', '&uacute;': 'ú',
    '&Aacute;': 'Á', '&Eacute;': 'É', '&Iacute;': 'Í', '&Oacute;': 'Ó', '&Uacute;': 'Ú',
    '&ntilde;': 'ñ', '&Ntilde;': 'Ñ', '&uuml;': 'ü', '&Uuml;': 'Ü',
    '&iquest;': '¿', '&iexcl;': '¡', '&ordm;': 'º', '&ordf;': 'ª',
    '&deg;': '°', '&middot;': '·', '&copy;': '©', '&reg;': '®',
    '&euro;': '€', '&pound;': '£', '&yen;': '¥', '&cent;': '¢',
    '&frac12;': '½', '&frac14;': '¼', '&frac34;': '¾',
    '&times;': '×', '&divide;': '÷', '&plusmn;': '±',
    '&ndash;': '–', '&mdash;': '—', '&hellip;': '…',
    '&laquo;': '«', '&raquo;': '»', '&lsquo;': "'", '&rsquo;': "'",
    '&ldquo;': '"', '&rdquo;': '"',
};

/**
 * Extrae texto legible desde HTML crudo (sin dependencias externas).
 * Elimina scripts/styles/comentarios/etiquetas y decodifica entidades comunes.
 */
export function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_m, n: string) => {
            const c = parseInt(n, 10);
            return (c > 0 && c <= 0x10FFFF) ? String.fromCodePoint(c) : ' ';
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) => {
            const c = parseInt(n, 16);
            return (c > 0 && c <= 0x10FFFF) ? String.fromCodePoint(c) : ' ';
        })
        .replace(/&[a-zA-Z]+;/g, (e) => HTML_ENTITIES[e] ?? e)
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
}

/**
 * Determina el MIME real de una fuente. Prioriza el content-type del header si está en la
 * allowlist; si no (p. ej. `application/octet-stream` o header genérico), resuelve por la
 * extensión del path/nombre de archivo.
 */
export function detectMimeFromUrl(urlOrName: string, contentTypeHeader?: string | null): string {
    const header = (contentTypeHeader || '').split(';')[0].trim().toLowerCase();
    if (header && header !== 'application/octet-stream' && ALLOWED_MIME.includes(header)) {
        return header;
    }
    const clean = urlOrName.split('?')[0].split('#')[0];
    const dot = clean.lastIndexOf('.');
    if (dot >= 0) {
        const ext = clean.slice(dot).toLowerCase();
        const byExt = EXT_TO_MIME[ext];
        if (byExt) return byExt;
    }
    return header;
}

/**
 * Divide un texto en ventanas con solape para procesar documentos largos con un LLM
 * cuyo contexto está limitado. Si el texto cabe en una ventana, devuelve [texto].
 */
export function chunkText(text: string, size: number, overlap: number): string[] {
    if (text.length <= size) return [text];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        chunks.push(text.slice(start, start + size));
        if (start + size >= text.length) break;
        start += size - overlap;
    }
    return chunks;
}

/**
 * Convierte una lista de componentes (piezas de un kit) en texto legible para
 * guardarlo dentro de atributos_tecnicos (que se renderiza como key-value).
 */
export function formatComponentes(componentes: Array<Record<string, any>>): string {
    return componentes
        .map(c => {
            const parts = [
                c?.nombre,
                c?.medida,
                c?.material,
                c?.cantidad ? `x${c.cantidad}` : '',
                c?.codigo ? `(${c.codigo})` : '',
            ].filter(Boolean).join(' ');
            return `- ${parts}`;
        })
        .join('\n');
}

/**
 * Elimina componentes duplicados (misma pieza capturada por dos chunks solapados
 * o por la pasada principal + pasada por chunks). Compara nombre+medida+material+cantidad.
 */
export function dedupComponentes<T extends Record<string, any>>(componentes: T[]): T[] {
    const seen = new Set<string>();
    return componentes.filter(c => {
        const key = [c?.nombre, c?.medida, c?.material, c?.cantidad]
            .map(x => String(x ?? '').trim().toLowerCase())
            .join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
