/**
 * Completado de descripción para productos DAI.
 *
 * DAI publica sus códigos con abreviaturas (ej. "SOP.TRANS HILUX 19-21"). Aquí se
 * construye una descripción legible y buscable a partir de dos fuentes:
 *   1. Fuente principal: el catálogo de dai.com.mx (`detalle.aplicacion` ya trae
 *      "SOPORTE PARA TRANSMISIÓN OEM …" y `especificaciones` trae marca/modelo/año).
 *   2. Fallback determinístico: expansión de abreviaturas locales cuando la web no
 *      responde o no trae `aplicacion`.
 */

export interface DaiProductoEnriquecido {
    aplicacion?: string | null;
    linea?: string | null;
    oem?: string | null;
    aplicaciones?: Array<{ marca?: string; modelo?: string; anio?: string; anioF?: string; motor?: string; cilindros?: string; oem?: string }>;
}

const ABREVIATURAS: Record<string, string> = {
    SOP: 'soporte',
    SOPORTE: 'soporte',
    TRANS: 'transmisión',
    TRANSMISION: 'transmisión',
    MOT: 'motor',
    STD: 'estándar',
    EST: 'estándar',
    AUT: 'automática',
    DER: 'derecho',
    IZQ: 'izquierdo',
    TRAS: 'trasero',
    FRONT: 'frontal',
    DEL: 'delantero',
    INF: 'inferior',
    SUP: 'superior',
    LAT: 'lateral',
    BASE: 'base',
    AMOR: 'amortiguador',
    JGO: 'juego',
    GOMA: 'goma',
    GOMAS: 'gomas',
    P: 'para',
    CASETA: 'caseta',
    CHASIS: 'chasis',
    CIL: 'cilindros',
    CILINDRO: 'cilindros',
    AUTOS: 'automóviles',
    AUTO: 'automóvil',
    CAMIONETAS: 'camionetas',
    CAMIONETA: 'camioneta',
    CAM: 'camión',
    AUTOBUS: 'autobús',
    HID: 'hidráulico',
    HIDRAUL: 'hidráulico',
};

const MODELOS: Record<string, string> = {
    SENTRA: 'Nissan Sentra',
    ALTIMA: 'Nissan Altima',
    MAXIMA: 'Nissan Maxima',
    HILUX: 'Toyota Hilux',
    TIGUAN: 'Volkswagen Tiguan',
    TRANSPORTER: 'Volkswagen Transporter',
    CADDY: 'Volkswagen Caddy',
    A3: 'Audi A3',
    TIGGO7: 'Chery Tiggo 7',
    FORTWO: 'Smart Fortwo',
    COOPER: 'Mini Cooper',
    CHEV: 'Chevrolet',
    FORD: 'Ford',
    NISSAN: 'Nissan',
    DODGE: 'Dodge',
    CUMMINS: 'Cummins',
};

function expandirAnio(y: string): string {
    const n = parseInt(y, 10);
    if (isNaN(n)) return y;
    // Heurística: <30 → 20xx (recientes), >=30 → 19xx (clásicos). Cubre los rangos reales de DAI.
    return (n >= 30 ? '19' : '20') + y;
}

function expandirToken(t: string): string {
    const up = t.toUpperCase();
    if (/^\d{2}-\d{2}$/.test(t)) {
        const [a, b] = t.split('-');
        return `${expandirAnio(a)}-${expandirAnio(b)}`;
    }
    const nCil = /^(\d)CIL$/.exec(up);
    if (nCil) return `${nCil[1]} cilindros`;
    if (ABREVIATURAS[up]) return ABREVIATURAS[up];
    if (MODELOS[up]) return MODELOS[up];
    return t;
}

/** "SOP.TRANS HILUX 19-21" → "Soporte transmisión Toyota Hilux 2019-2021". */
export function expandirDescripcionDai(raw: string): string {
    const src = String(raw ?? '').trim();
    if (!src) return '';
    const palabras = src.split(/\s+/);
    const out: string[] = [];
    for (const palabra of palabras) {
        if (/^\d+\.\d+$/.test(palabra)) { out.push(palabra); continue; } // "2.0"
        const sub = palabra.split(/[./]+/).filter(Boolean);
        out.push(sub.map(expandirToken).join(' '));
    }
    const resultado = out.join(' ').replace(/\s+/g, ' ').trim();
    return resultado ? resultado[0].toUpperCase() + resultado.slice(1) : resultado;
}

function titleCase(s: string): string {
    return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

/** Quita el sufijo "OEM 12371-0L210" para dejar una descripción limpia. */
function limpiarAplicacion(app: string): string {
    return app.replace(/\s*OEM\s*[\w-]+/i, '').replace(/\s+/g, ' ').trim();
}

/** Construye el título legible para el artículo DAI. */
export function construirTituloDai(producto: DaiProductoEnriquecido | null | undefined, crudo: string, sku: string): string {
    const app = limpiarAplicacion(String(producto?.aplicacion ?? '').trim());
    const veh = (producto?.aplicaciones || [])[0];
    if (app) {
        const partes = [app];
        if (veh?.marca || veh?.modelo) partes.push([veh.marca, veh.modelo].filter(Boolean).join(' '));
        if (veh?.anio) partes.push(`${veh.anio}${veh.anioF ? '-' + veh.anioF : ''}`);
        const titulo = titleCase(partes.filter(Boolean).join(' '));
        if (titulo) return titulo;
    }
    return expandirDescripcionDai(crudo) || crudo || String(sku);
}

/** Construye la descripción larga (título + línea + aplicación + aplicaciones). */
export function construirDescripcionDai(producto: DaiProductoEnriquecido | null | undefined, titulo: string, crudo: string): string {
    const bloques: string[] = [titulo || expandirDescripcionDai(crudo) || crudo];
    if (producto?.linea) bloques.push(`Línea: ${producto.linea}`);
    if (producto?.aplicacion) bloques.push(`Aplicación: ${producto.aplicacion}`);
    const apps = (producto?.aplicaciones || [])
        .map((a) => `${a.marca || ''} ${a.modelo || ''} ${a.anio || ''}${a.anioF ? '-' + a.anioF : ''}${a.motor ? ' ' + a.motor : ''}`.trim())
        .filter(Boolean);
    if (apps.length > 0) bloques.push(`Aplicaciones: ${apps.join(' | ')}`);
    return bloques.filter(Boolean).join('\n').slice(0, 2000);
}
