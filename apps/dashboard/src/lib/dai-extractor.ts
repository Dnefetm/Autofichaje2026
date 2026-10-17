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
}

export interface DaiProducto {
    dai: string;
    imagen: string | null;
    w360: string | null;
    linea: string | null;
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
    }));

    return {
        dai: String(d.dai ?? '').trim(),
        imagen: d.imagen ? String(d.imagen) : null,
        w360: d.w360 ? String(d.w360) : null,
        linea: d.linea ? String(d.linea) : null,
        oem: d.oem ? String(d.oem) : null,
        aplicaciones,
    };
}

/** Limpia el apóstrofo inicial de Excel y valida EAN/UPC (8-14 dígitos). */
export function limpiarEan(raw: string | null | undefined): string | null {
    const s = String(raw ?? '').replace(/^'+/, '').trim();
    return /^\d{8,14}$/.test(s) ? s : null;
}
