/**
 * Extractor de dai.com.mx (Nivel 1: HTTP directo, server-rendered sin token).
 * Endpoint real identificado: POST /Catalogo/ObtenerCatalogoBusqueda
 *   body form-urlencoded: Busqueda=<codigo>&Equivalencia=false
 * Devuelve: response[].detalle (dai, imagen, w360, linea, oem) y
 *           response[].lista (aplicaciones vehiculares: marca/modelo/año/motor).
 * OJO: el endpoint busca por SUBcadena → hay que filtrar coincidencia exacta.
 */

export interface DaiAplicacion {
    marca: string;
    modelo: string;
    anio: string;
    anioF: string;
    cilindros: string;
    motor: string;
    aplicacion: string;
    especificaciones: string;
    oem: string;
}

export interface DaiProducto {
    dai: string;
    imagen: string | null;
    w360: string | null;
    linea: string | null;
    /** Descripción completa oficial de DAI (ej. "SOPORTE PARA TRANSMISIÓN OEM 12371-0L210"). */
    aplicacion: string | null;
    oem: string | null;
    aplicaciones: DaiAplicacion[];
}

const ENDPOINT = 'https://dai.com.mx/Catalogo/ObtenerCatalogoBusqueda';

export async function extraerProductoDai(codigo: string): Promise<DaiProducto | null> {
    const clave = String(codigo).trim();
    if (!clave) return null;

    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ Busqueda: clave, Equivalencia: 'false' }).toString(),
    });
    if (!res.ok) return null;

    const json: any = await res.json();
    const items: any[] = Array.isArray(json?.response) ? json.response : [];

    // Coincidencia EXACTA del número DAI (el endpoint busca por subcadena)
    const exacto = items.find((x) => String(x?.detalle?.dai ?? '').trim() === clave);
    if (!exacto) return null;

    const d = exacto.detalle || {};
    // Las aplicaciones vehiculares viven en `especificaciones` (array en la raíz), no en `lista`.
    const appsRaw = Array.isArray(exacto.especificaciones) ? exacto.especificaciones : [];

    const aplicaciones: DaiAplicacion[] = appsRaw.map((a: any) => ({
        marca: String(a?.marca ?? '').trim(),
        modelo: String(a?.modelo ?? '').trim(),
        anio: String(a?.['año'] ?? a?.anio ?? '').trim(),
        anioF: String(a?.['añoF'] ?? a?.anioF ?? '').trim(),
        cilindros: String(a?.cilindros ?? '').trim(),
        motor: String(a?.motor ?? '').trim(),
        aplicacion: String(a?.aplicacion ?? '').trim(),
        especificaciones: String(a?.especificaciones ?? '').trim(),
        oem: String(a?.oem ?? '').trim(),
    }));

    const oemDeEspecificaciones = aplicaciones.map((a) => a.oem).find((o) => o !== '') || null;
    const oem = (d.oem ? String(d.oem).trim() : null) || oemDeEspecificaciones;

    return {
        dai: String(d.dai ?? '').trim(),
        imagen: d.imagen ? String(d.imagen) : null,
        w360: d.w360 ? String(d.w360) : null,
        linea: d.linea ? String(d.linea) : null,
        aplicacion: d.aplicacion ? String(d.aplicacion).trim() : null,
        oem,
        aplicaciones,
    };
}

/** Limpia el apóstrofo inicial de Excel y valida EAN/UPC (8-14 dígitos). */
export function limpiarEan(raw: string | null | undefined): string | null {
    const s = String(raw ?? '').replace(/^'+/, '').trim();
    return /^\d{8,14}$/.test(s) ? s : null;
}

/**
 * Frames del visor 360 de DAI. NO es un visor interactivo: es una carpeta con
 * imágenes estáticas (img/1.jpg … img/64.jpg) servidas por HTTP. Devuelve las URLs.
 */
export async function extraerFrames360(codigo: string): Promise<string[]> {
    const base = `https://dai.com.mx/panel/files/360/${codigo}/`;
    try {
        const res = await fetch(base);
        if (!res.ok) return [];
        const html = await res.text();
        const frames: string[] = [];
        const re = /img\/(\d+)\.jpg/g;
        let m;
        while ((m = re.exec(html)) !== null) frames.push(`${base}img/${m[1]}.jpg`);
        return frames;
    } catch {
        return [];
    }
}
